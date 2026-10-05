import assert from "node:assert/strict";
import test from "node:test";
import { signInLinkProblem } from "../src/sign-in-link.js";

test("an expired or reused sign-in link explains itself", () => {
  assert.match(signInLinkProblem({ hash: "#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid", search: "" }), /expired or was already used/);
  assert.match(signInLinkProblem({ hash: "", search: "?error=access_denied&error_code=otp_expired" }), /expired or was already used/);
});

test("any other link error still says what to do", () => {
  assert.match(signInLinkProblem({ hash: "#error=server_error", search: "" }), /didn't work. Enter your email/);
});

test("a normal visit shows nothing", () => {
  assert.equal(signInLinkProblem({ hash: "", search: "" }), "");
  assert.equal(signInLinkProblem({ hash: "#access_token=x&type=magiclink", search: "" }), "");
  assert.equal(signInLinkProblem(undefined), "");
});
