// A quick "are you a person" check before the sign-in service sends an email (owner decision
// 2026-10-21). Without it, a script could use up the whole site's hourly email budget and no
// family could get a sign-in link.
//
// It uses Cloudflare Turnstile, loaded from Cloudflare only when a site key is configured
// (VITE_TURNSTILE_SITE_KEY). Most people never see it; when Cloudflare is unsure it shows one
// checkbox. The sign-in service checks the token (GOTRUE_SECURITY_CAPTCHA_*), so this is a
// convenience for honest visitors, not the protection itself.
export const TURNSTILE_SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const TIMEOUT_MS = 60_000;

export const HUMAN_CHECK_MESSAGES = {
  loadFailed:
    "The quick person check didn't load. Check your connection, or pause any content blocker for this site, then try again.",
  failed: "We couldn't confirm you're a person. Please try again.",
  timedOut: "The person check took too long. Please try again.",
};

// One script load per window, shared by every check on the page.
const loading = new WeakMap();

function loadTurnstile(doc, win) {
  if (win.turnstile) return Promise.resolve(win.turnstile);
  if (!loading.has(win)) {
    const script = doc.createElement("script");
    loading.set(win, new Promise((resolve, reject) => {
      script.src = TURNSTILE_SCRIPT;
      script.async = true;
      script.onload = () => (win.turnstile ? resolve(win.turnstile) : reject(new Error(HUMAN_CHECK_MESSAGES.loadFailed)));
      script.onerror = () => reject(new Error(HUMAN_CHECK_MESSAGES.loadFailed));
      doc.head.append(script);
    }).catch((error) => {
      // A failed load can be retried on the next attempt.
      loading.delete(win);
      script.remove();
      throw error;
    }));
  }
  return loading.get(win);
}

// Returns a function that resolves with a one-time token, or rejects with a plain message.
export function createHumanCheck(siteKey, { doc = globalThis.document, win = globalThis.window } = {}) {
  if (!siteKey) return null;
  return async function humanCheck() {
    const turnstile = await loadTurnstile(doc, win);
    const box = doc.createElement("div");
    box.className = "human-check";
    box.setAttribute("role", "status");
    const note = doc.createElement("p");
    note.textContent = "One moment: checking that you're a person.";
    const slot = doc.createElement("div");
    box.append(note, slot);
    doc.body.append(box);
    let widget = null;
    let timer = null;
    try {
      return await new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error(HUMAN_CHECK_MESSAGES.timedOut)), TIMEOUT_MS);
        widget = turnstile.render(slot, {
          sitekey: siteKey,
          appearance: "interaction-only",
          callback: resolve,
          "error-callback": () => reject(new Error(HUMAN_CHECK_MESSAGES.failed)),
          "expired-callback": () => reject(new Error(HUMAN_CHECK_MESSAGES.timedOut)),
          "timeout-callback": () => reject(new Error(HUMAN_CHECK_MESSAGES.timedOut)),
        });
      });
    } finally {
      clearTimeout(timer);
      try {
        if (widget != null) turnstile.remove(widget);
      } catch {
        // The widget is gone with its box either way.
      }
      box.remove();
    }
  };
}
