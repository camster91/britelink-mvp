import { useCallback, useRef, useState } from "react";

// What a signed-in person is typing, kept in this browser so the 15-minute idle sign-out does not
// lose it. The sign-in email link usually opens a new tab, so this uses localStorage: a tab-only
// store would be empty by the time they are back.
//
// Owner decision (2026-10-18): a draft stays on this device for at most 24 hours, is only ever
// restored for the same person, and is removed as soon as it is sent or submitted, or when anyone
// presses Sign out. Consent is never part of a draft.
export const DRAFT_PREFIX = "britelink:draft:";
export const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

// Reading localStorage throws when the browser blocks site data, so every access is guarded: a
// draft that cannot be kept must never take a form down with it.
export function browserLocalStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

// Every draft key starts with the person's id, so one family member never sees another's draft.
export function draftKey(userId, ...parts) {
  if (!userId || parts.some((part) => part == null || part === "")) return null;
  return `${DRAFT_PREFIX}${userId}:${parts.join(":")}`;
}

export function loadDraft(storage, key, now = Date.now()) {
  if (!storage || !key) return null;
  try {
    const kept = JSON.parse(storage.getItem(key) ?? "null");
    if (!kept || typeof kept.savedAt !== "number" || !("value" in kept)) return null;
    if (now - kept.savedAt > DRAFT_TTL_MS) {
      storage.removeItem(key);
      return null;
    }
    return kept.value;
  } catch {
    return null;
  }
}

// Returns false when the draft could not be kept (no storage, blocked, or over quota).
export function saveDraft(storage, key, value, now = Date.now()) {
  if (!storage || !key) return false;
  try {
    storage.setItem(key, JSON.stringify({ value, savedAt: now }));
    return true;
  } catch {
    return false;
  }
}

export function discardDraft(storage, key) {
  if (!key) return;
  try {
    storage?.removeItem(key);
  } catch {
    // Nothing to do: a store we cannot write to holds no draft of ours.
  }
}

function draftKeys(storage) {
  const keys = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(DRAFT_PREFIX)) keys.push(key);
  }
  return keys;
}

// Run on sign-in, so a draft older than a day does not linger on the device.
export function discardExpiredDrafts(storage, now = Date.now()) {
  try {
    for (const key of draftKeys(storage)) loadDraft(storage, key, now);
  } catch {
    // A blocked store holds nothing to tidy.
  }
}

// Pressing Sign out leaves no draft behind on the device, whoever wrote it.
export function discardAllDrafts(storage) {
  try {
    for (const key of draftKeys(storage)) storage.removeItem(key);
  } catch {
    // A blocked store holds nothing to remove.
  }
}

// A text box whose words are kept under `key` (null keeps nothing). Switching to another key shows
// that key's draft; clearing the text removes the draft. A setter from an earlier key (a send that
// finishes after the person moved to another case) updates that key's draft only, never the box
// now on screen.
export function useKeptText(key) {
  const [text, setTextState] = useState(() => loadDraft(browserLocalStorage(), key) ?? "");
  const [shownKey, setShownKey] = useState(key);
  if (shownKey !== key) {
    setShownKey(key);
    setTextState(loadDraft(browserLocalStorage(), key) ?? "");
  }
  const currentKey = useRef(key);
  currentKey.current = key;
  const setText = useCallback(
    (value) => {
      if (value) saveDraft(browserLocalStorage(), key, value);
      else discardDraft(browserLocalStorage(), key);
      if (currentKey.current === key) setTextState(value);
    },
    [key],
  );
  return [text, setText];
}
