// A sign-in link that has expired, or was already used, comes back as
// #error=...&error_code=otp_expired (or the same in the query string). Without reading it the family
// lands on a plain sign-in form with no idea why. Read once, before anything rewrites the URL.
export function signInLinkProblem(location = globalThis.location) {
  if (!location) return "";
  const params = new URLSearchParams(String(location.hash ?? "").replace(/^#/, ""));
  const query = new URLSearchParams(String(location.search ?? ""));
  const code = params.get("error_code") ?? query.get("error_code") ?? "";
  const error = params.get("error") ?? query.get("error") ?? "";
  if (!code && !error) return "";
  return code === "otp_expired"
    ? "That sign-in link has expired or was already used. Enter your email below to get a new one."
    : "That sign-in link didn't work. Enter your email below to get a new one.";
}
