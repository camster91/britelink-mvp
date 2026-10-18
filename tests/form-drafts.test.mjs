import assert from "node:assert/strict";
import test from "node:test";
import {
  DRAFT_TTL_MS,
  discardAllDrafts,
  discardDraft,
  discardExpiredDrafts,
  draftKey,
  loadDraft,
  saveDraft,
} from "../src/form-drafts.js";

function memoryStorage(entries = []) {
  const values = new Map(entries);
  return {
    get length() {
      return values.size;
    },
    key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    keys: () => [...values.keys()],
  };
}

test("a draft key belongs to one person and needs every part", () => {
  assert.equal(draftKey("u1", "message", "h1", "c1"), "britelink:draft:u1:message:h1:c1");
  assert.notEqual(draftKey("u1", "message", "h1", "c1"), draftKey("u2", "message", "h1", "c1"));
  assert.equal(draftKey(null, "message", "h1", "c1"), null);
  assert.equal(draftKey("u1", "message", "h1", undefined), null);
  assert.equal(draftKey("u1", "message", "h1", ""), null);
});

test("a draft comes back within a day and is removed after it", () => {
  const storage = memoryStorage();
  const key = draftKey("u1", "message", "h1", "c1");
  const start = Date.UTC(2026, 9, 18, 9);
  assert.equal(saveDraft(storage, key, "Half a message", start), true);
  assert.equal(loadDraft(storage, key, start + DRAFT_TTL_MS - 1), "Half a message");
  assert.equal(loadDraft(storage, key, start + DRAFT_TTL_MS + 1), null);
  assert.equal(storage.getItem(key), null, "an expired draft is deleted, not just hidden");
});

test("objects round-trip and a corrupt entry reads as no draft", () => {
  const storage = memoryStorage([["britelink:draft:u1:lesson:h1:l1", "{not json"]]);
  assert.equal(loadDraft(storage, "britelink:draft:u1:lesson:h1:l1"), null);
  const key = draftKey("u1", "lesson", "h1", "l2");
  saveDraft(storage, key, { status: "completed", note: "Loved it" });
  assert.deepEqual(loadDraft(storage, key), { status: "completed", note: "Loved it" });
  discardDraft(storage, key);
  assert.equal(loadDraft(storage, key), null);
});

test("Sign out removes every draft on the device and nothing else", () => {
  const storage = memoryStorage([["britelink-demo-profile", "{}"], ["britelink:last-activity", "1"]]);
  saveDraft(storage, draftKey("u1", "message", "h1", "c1"), "one");
  saveDraft(storage, draftKey("u2", "intake", "h2", "l1"), { goals: "two" });
  discardAllDrafts(storage);
  assert.deepEqual(storage.keys(), ["britelink-demo-profile", "britelink:last-activity"]);
});

test("old drafts are tidied away while fresh ones stay", () => {
  const storage = memoryStorage();
  const now = Date.UTC(2026, 9, 18, 9);
  saveDraft(storage, draftKey("u1", "message", "h1", "old"), "stale", now - DRAFT_TTL_MS - 1);
  saveDraft(storage, draftKey("u1", "message", "h1", "new"), "fresh", now - 1000);
  discardExpiredDrafts(storage, now);
  assert.deepEqual(storage.keys(), [draftKey("u1", "message", "h1", "new")]);
});

test("a blocked or full browser store never throws", () => {
  const blocked = {
    get length() {
      throw new Error("SecurityError");
    },
    key() {
      throw new Error("SecurityError");
    },
    getItem() {
      throw new Error("SecurityError");
    },
    setItem() {
      throw new Error("QuotaExceededError");
    },
    removeItem() {
      throw new Error("SecurityError");
    },
  };
  const key = draftKey("u1", "message", "h1", "c1");
  assert.equal(saveDraft(blocked, key, "x"), false);
  assert.equal(saveDraft(null, key, "x"), false);
  assert.equal(saveDraft(memoryStorage(), null, "x"), false);
  assert.equal(loadDraft(blocked, key), null);
  assert.doesNotThrow(() => discardDraft(blocked, key));
  assert.doesNotThrow(() => discardAllDrafts(blocked));
  assert.doesNotThrow(() => discardExpiredDrafts(blocked));
});
