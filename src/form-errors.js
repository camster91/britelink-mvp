// Shared form-error handling (AGENTS.md: errors name the fields, use aria-invalid/aria-describedby,
// are announced, and move focus to the first invalid control). Forms set noValidate and call these
// instead of relying on the browser's own bubbles, which name nothing and are not announced.

const groupKey = (element) => (element.type === "radio" ? `radio:${element.name}` : element.id || element.name);

function fieldLabel(element) {
  if (element.dataset?.errorLabel) return element.dataset.errorLabel;
  if (element.type === "radio") return element.closest("fieldset")?.querySelector("legend")?.textContent ?? "";
  // Only the label's own words, not the text of the control inside it or its hint spans.
  const label = element.labels?.[0];
  return [...(label?.childNodes ?? [])].filter((node) => node.nodeType === 3).map((node) => node.textContent).join(" ");
}

// Every required answer that is still missing or invalid, once per radio group, in form order.
export function missingFields(form) {
  const found = [];
  const seen = new Set();
  for (const element of form?.elements ?? []) {
    if (!element.willValidate || element.checkValidity()) continue;
    const key = groupKey(element);
    if (seen.has(key)) continue;
    seen.add(key);
    found.push({ key, element, label: fieldLabel(element).replace(/\s+/g, " ").trim() });
  }
  return found;
}

// Marks exactly the missing fields invalid (and points them at the message that names them).
export function markMissing(form, missing, describedBy) {
  const keys = new Set(missing.map((item) => item.key));
  for (const element of form?.elements ?? []) {
    if (!element.willValidate) continue;
    if (keys.has(groupKey(element))) {
      element.setAttribute("aria-invalid", "true");
      if (describedBy) element.setAttribute("aria-describedby", describedBy);
    } else if (element.getAttribute("aria-invalid") === "true" && element.dataset?.errorManaged !== "react") {
      element.removeAttribute("aria-invalid");
      if (describedBy && element.getAttribute("aria-describedby") === describedBy) element.removeAttribute("aria-describedby");
    }
  }
}

// One plain sentence naming what is missing.
export function missingMessage(labels) {
  return `Please complete ${labels.length === 1 ? "this answer" : `these ${labels.length} answers`}: ${labels.join("; ")}.`;
}

// For a form's onChange: a field stops being flagged as soon as it is valid.
export function clearFixedField(event) {
  const element = event.target;
  if (element?.dataset?.errorManaged === "react") return;
  if (element?.getAttribute?.("aria-invalid") !== "true" || !element.checkValidity?.()) return;
  const group = element.type === "radio" ? element.form?.querySelectorAll(`input[type=radio][name="${element.name}"]`) : [element];
  for (const item of group ?? []) {
    item.removeAttribute("aria-invalid");
    item.removeAttribute("aria-describedby");
  }
}

// Validates a form; on problems marks the fields, focuses the first and returns the message.
export function checkRequired(form, describedBy) {
  const missing = missingFields(form);
  markMissing(form, missing, describedBy);
  if (!missing.length) return "";
  missing[0].element.focus();
  return missingMessage(missing.map((item) => item.label));
}
