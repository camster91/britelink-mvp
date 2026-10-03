// Malware-scan adapter for quarantined case-message attachments.
//
// docs/ATTACHMENT_OPERATIONS.md, deployment requirement 3: "Connect object creation to an
// isolated malware scanner. The scanner reads quarantined objects with service credentials
// and records only clean or rejected through a trusted server adapter."
//
// This is that adapter. It is a server-side service job, not a browser control: it holds the
// service-role key, so it must never run in client code.
//
// SHIPS UNWIRED. No private bucket and no ClamAV instance are deployed, so running this
// without configuration exits 2 and says so. Exit 2 is deliberately NOT success -- an
// unconfigured scanner must never read as a passing scan.
//
// FAIL-CLOSED is the property that matters most here. case_attachments has no 'scan_failed'
// state and this adapter never invents one: on any scanner error, timeout, or digest
// mismatch it records nothing, the object stays in pending_scan quarantine, and the existing
// attachment.scan_stale signal escalates after 15 minutes. A scanner outage cannot make an
// object downloadable.
//
// Usage:
//   node scripts/attachment-scanner.mjs --check    # verify configuration only, exit 0/2
//   node scripts/attachment-scanner.mjs            # scan the pending queue once
//   node scripts/attachment-scanner.mjs --reconcile # also reconcile the observed object set

import { createHash } from "node:crypto";
import { connect } from "node:net";
import { pathToFileURL } from "node:url";

const BUCKET = "case-attachments";
const DEFAULT_CLAMD_PORT = 3310;
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_BATCH = 25;

// clamd result codes become scan_result_code, whose DB check is ^[A-Za-z0-9][A-Za-z0-9._-]{1,79}$.
// Signature names routinely contain characters that fail that, so they are sanitised rather
// than passed through -- a malformed code would abort the whole verdict.
export function sanitizeResultCode(value) {
  const cleaned = String(value ?? "")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^[^A-Za-z0-9]+/, "")
    .slice(0, 80);
  return cleaned.length >= 2 ? cleaned : "unknown";
}

// Parses one clamd INSTREAM reply. Anything not recognised is an error, never a clean:
// defaulting an unknown reply to 'clean' would quietly publish unscanned files.
export function parseClamdReply(reply) {
  const text = String(reply ?? "").replace(/\0/g, "").trim();
  if (!text) return { verdict: "error", code: "empty_reply" };
  const separator = text.indexOf(":");
  if (separator === -1) return { verdict: "error", code: "unrecognised_reply" };
  const payload = text.slice(separator + 1).trim();
  if (/^OK$/i.test(payload)) return { verdict: "clean", code: "ok" };
  if (/\bFOUND$/i.test(payload)) {
    const signature = payload.replace(/\s*FOUND$/i, "").trim();
    return { verdict: "rejected", code: sanitizeResultCode(signature) };
  }
  if (/\bERROR$/i.test(payload)) return { verdict: "error", code: sanitizeResultCode(payload.replace(/\s*ERROR$/i, "")) };
  return { verdict: "error", code: "unrecognised_reply" };
}

export function configure(env = process.env) {
  const missing = [];
  const supabaseUrl = env.BRITELINK_SUPABASE_URL?.trim();
  const serviceRoleKey = env.BRITELINK_SERVICE_ROLE_KEY?.trim();
  const clamdHost = env.BRITELINK_CLAMD_HOST?.trim();
  if (!supabaseUrl) missing.push("BRITELINK_SUPABASE_URL");
  if (!serviceRoleKey) missing.push("BRITELINK_SERVICE_ROLE_KEY");
  if (!clamdHost) missing.push("BRITELINK_CLAMD_HOST");
  const clamdPort = Number(env.BRITELINK_CLAMD_PORT ?? DEFAULT_CLAMD_PORT);
  if (!Number.isInteger(clamdPort) || clamdPort < 1 || clamdPort > 65535) missing.push("BRITELINK_CLAMD_PORT (invalid)");
  const timeoutMs = Number(env.BRITELINK_CLAMD_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
  const batchSize = Number(env.BRITELINK_SCAN_BATCH ?? DEFAULT_BATCH);
  return { configured: missing.length === 0, missing, supabaseUrl, serviceRoleKey, clamdHost, clamdPort, timeoutMs, batchSize };
}

// Streams bytes to clamd using the INSTREAM protocol:
//   zINSTREAM\0  [ <4-byte BE length> <chunk> ]...  <4-byte zero>
export function streamScan({ host, port, bytes, timeoutMs }) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => { if (!settled) { settled = true; socket.destroy(); resolve(result); } };
    const socket = connect({ host, port });
    const timer = setTimeout(() => finish({ verdict: "error", code: "scanner_timeout" }), timeoutMs);

    socket.on("connect", () => {
      const header = Buffer.alloc(4);
      header.writeUInt32BE(bytes.length, 0);
      const terminator = Buffer.alloc(4);
      socket.write(Buffer.concat([Buffer.from("zINSTREAM\0", "ascii"), header, bytes, terminator]));
    });
    let chunks = [];
    socket.on("data", (chunk) => chunks.push(chunk));
    socket.on("end", () => { clearTimeout(timer); finish(parseClamdReply(Buffer.concat(chunks).toString("binary"))); });
    socket.on("close", () => { clearTimeout(timer); finish({ verdict: "error", code: "scanner_closed" }); });
    socket.on("error", () => { clearTimeout(timer); finish({ verdict: "error", code: "scanner_unreachable" }); });
  });
}

export function digestOf(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

// Handles one attachment end to end. Returns a report entry and never throws for a scanner
// failure: a failed scan is a deferral, and must not abort the rest of the queue.
export async function scanOne({ attachment, storage, rpc, scanner }) {
  const base = { attachmentId: attachment.attachment_id, householdId: attachment.household_id };
  const downloaded = await storage.download(attachment.object_path);
  if (downloaded.error) return { ...base, outcome: "deferred", reason: "download_failed", detail: downloaded.error.message };
  const bytes = Buffer.from(typeof downloaded.data?.arrayBuffer === "function"
    ? await downloaded.data.arrayBuffer() : downloaded.data);

  const verdict = await scanner({ bytes });
  if (verdict.verdict === "error") {
    // The whole point: record nothing, leave the object quarantined.
    return { ...base, outcome: "deferred", reason: "scan_error", detail: verdict.code };
  }

  const recorded = await rpc("admin_record_attachment_scan", {
    target_household: attachment.household_id,
    target_attachment: attachment.attachment_id,
    scan_provider: scanner.provider ?? "clamav",
    scan_verdict: verdict.verdict,
    scan_result_code: verdict.code,
    content_sha256: digestOf(bytes),
  });
  if (recorded.error) return { ...base, outcome: "deferred", reason: "record_failed", detail: recorded.error.message };

  const entry = { ...base, outcome: verdict.verdict, code: verdict.code, recorded: recorded.data?.[0] ?? null };
  if (verdict.verdict === "rejected") {
    // Requirement 4: delete rejected objects promptly, keeping the privacy-minimal metadata
    // row. If this fails the object stays and attachment.object_orphaned will catch it.
    const removed = await storage.remove(attachment.object_path);
    entry.objectDeleted = !removed.error;
    if (removed.error) entry.deleteError = removed.error.message;
  }
  return entry;
}

export async function runOnce({ config, storage, rpc, scanner, reconcile }) {
  const queued = await rpc("admin_list_pending_scan_attachments", { max_rows: config.batchSize });
  if (queued.error) throw new Error(`List pending scans: ${queued.error.message}`);
  const entries = [];
  for (const attachment of queued.data ?? []) entries.push(await scanOne({ attachment, storage, rpc, scanner }));

  let reconciliation = null;
  if (reconcile) {
    const listed = await storage.list();
    if (listed.error) reconciliation = { error: listed.error.message };
    else {
      const byHousehold = new Map();
      for (const path of listed.paths) {
        const householdId = String(path).split("/")[0];
        if (!byHousehold.has(householdId)) byHousehold.set(householdId, []);
        byHousehold.get(householdId).push(path);
      }
      reconciliation = { households: [] };
      for (const [householdId, paths] of byHousehold) {
        const result = await rpc("admin_reconcile_attachment_objects", { target_household: householdId, present_object_paths: paths });
        reconciliation.households.push({ householdId, observed: result.error ? null : result.data?.[0]?.observed_count, error: result.error?.message });
      }
    }
  }
  return { entries, reconciliation };
}

function summarize(entries) {
  return entries.reduce((totals, entry) => { totals[entry.outcome] = (totals[entry.outcome] ?? 0) + 1; return totals; }, {});
}

async function main(argv) {
  const config = configure();
  if (!config.configured) {
    console.error("UNWIRED: the malware scanner is not deployed, so nothing can be scanned.");
    console.error(`Missing configuration: ${config.missing.join(", ")}`);
    console.error("This exit code is 2, not 0: an unconfigured scanner is not a passing scan.");
    return 2;
  }
  if (argv.includes("--check")) { console.log("Attachment scanner configuration is complete."); return 0; }

  const { createClient } = await import("@supabase/supabase-js");
  const client = createClient(config.supabaseUrl, config.serviceRoleKey, { auth: { persistSession: false } });
  const storage = {
    download: (path) => client.storage.from(BUCKET).download(path),
    remove: (path) => client.storage.from(BUCKET).remove([path]).then((r) => (r.error ? { error: r.error } : { data: r.data })),
    list: () => listAllObjects(client),
  };
  const rpc = (name, args) => client.rpc(name, args).then((r) => (r.error ? { error: r.error } : { data: r.data }));
  const scanner = (input) => streamScan({ host: config.clamdHost, port: config.clamdPort, bytes: input.bytes, timeoutMs: config.timeoutMs });

  const report = await runOnce({ config, storage, rpc, scanner, reconcile: argv.includes("--reconcile") });
  console.log(JSON.stringify({ generatedAt: new Date().toISOString(), summary: summarize(report.entries), ...report }, null, 2));
  // Deferrals are not failures of the job, but they must be visible.
  return report.entries.some((entry) => entry.outcome === "deferred") ? 1 : 0;
}

// Supabase Storage's list() is not recursive: an entry with no id is a folder placeholder.
// Object paths are household/case/message/attachment, so reconciliation has to walk down.
// UNVERIFIED: no bucket exists yet, so this walk has never run against real Storage. It is
// the part of this adapter that needs staging evidence before the reconciler is trusted.
export async function listAllObjects(client, prefix = "", depth = 0) {
  if (depth > 4) return { paths: [] };
  const paths = [];
  const limit = 1000;
  for (let offset = 0; ; offset += limit) {
    const result = await client.storage.from(BUCKET).list(prefix, {
      limit, offset, sortBy: { column: "name", order: "asc" },
    });
    if (result.error) return { error: result.error };
    const page = result.data ?? [];
    for (const item of page) {
      const path = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.id) paths.push(path);
      else {
        const nested = await listAllObjects(client, path, depth + 1);
        if (nested.error) return { error: nested.error };
        paths.push(...nested.paths);
      }
    }
    if (page.length < limit) break;
  }
  return { paths };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }).catch((error) => { console.error(`Attachment scanner failed: ${error.message}`); process.exitCode = 1; });
}
