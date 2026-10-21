#!/usr/bin/env python3
"""Release one approved commit of the web app through Coolify, and put the old one back if it fails.

Owner decision 2026-10-21: every web release waits for a one-click approval (the Release
workflow's production-change environment), and a release that does not come up healthy is undone
automatically. Coolify still builds and runs the app; this script only tells it which commit to
deploy and checks the result from outside, the way a visitor sees it.

Steps:
  1. Read the commit the live site reports at /version.json (the one to go back to).
  2. Pin Coolify's web app to the approved commit and start a deployment.
  3. Wait for that deployment to finish, then for /version.json to name the new commit.
  4. Check the home page loads.
  If 2-4 fail, pin the previous commit, deploy it, wait until the site names it again, and exit 1
  either way so the run shows red.

Environment: COOLIFY_URL, COOLIFY_API_TOKEN, COOLIFY_WEB_APP_UUID, SITE_URL, RELEASE_SHA.
The token is sent only to COOLIFY_URL and never printed.
"""
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

SHA = re.compile(r"^[0-9a-f]{40}$")


class ReleaseError(Exception):
    pass


def http(method, url, token=None, body=None, timeout=30):
    """Returns (status, text). Network failures come back as status 0."""
    data = None if body is None else json.dumps(body).encode()
    request = urllib.request.Request(url, data=data, method=method)
    request.add_header("Accept", "application/json")
    if data is not None:
        request.add_header("Content-Type", "application/json")
    if token:
        request.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, response.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as error:
        return error.code, error.read().decode("utf-8", "replace")
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        return 0, str(error)


class Release:
    def __init__(self, env, call=http, sleep=time.sleep, clock=time.monotonic, log=print):
        self.coolify = env["COOLIFY_URL"].rstrip("/")
        self.token = env["COOLIFY_API_TOKEN"]
        self.app = env["COOLIFY_WEB_APP_UUID"]
        self.site = env["SITE_URL"].rstrip("/")
        self.sha = env["RELEASE_SHA"].strip()
        self.call = call
        self.sleep = sleep
        self.clock = clock
        self.log = log
        if not SHA.match(self.sha):
            raise ReleaseError(f"RELEASE_SHA is not a full commit SHA: {self.sha!r}")

    def api(self, method, path, body=None):
        status, text = self.call(method, f"{self.coolify}/api/v1{path}", self.token, body)
        if not 200 <= status < 300:
            raise ReleaseError(f"Coolify {method} {path} answered {status or 'nothing'}")
        try:
            return json.loads(text) if text else {}
        except ValueError:
            raise ReleaseError(f"Coolify {method} {path} did not answer with JSON")

    def live_commit(self):
        status, text = self.call("GET", f"{self.site}/version.json?release={int(self.clock())}")
        if status != 200:
            return None
        try:
            commit = json.loads(text).get("commit")
        except (ValueError, AttributeError):
            return None
        return commit if isinstance(commit, str) and SHA.match(commit) else None

    def deploy(self, sha):
        self.api("PATCH", f"/applications/{self.app}", {"git_commit_sha": sha})
        started = self.api("GET", f"/deploy?uuid={self.app}&force=false")
        deployments = started.get("deployments") or []
        deployment = deployments[0].get("deployment_uuid") if deployments else None
        if not deployment:
            raise ReleaseError("Coolify did not start a deployment")
        self.log(f"Coolify deployment {deployment} started for {sha}")
        return deployment

    def wait_for(self, deployment, sha, minutes=20):
        deadline = self.clock() + minutes * 60
        finished = False
        while self.clock() < deadline:
            if not finished:
                state = (self.api("GET", f"/deployments/{deployment}").get("status") or "").lower()
                if state in ("failed", "cancelled", "cancelled-by-user", "error"):
                    raise ReleaseError(f"Coolify deployment {deployment} ended as {state}")
                finished = state == "finished"
            if finished and self.live_commit() == sha:
                return
            self.sleep(15)
        raise ReleaseError(f"the site did not report {sha} within {minutes} minutes")

    def check_home(self):
        status, text = self.call("GET", f"{self.site}/")
        if status != 200 or '<div id="root">' not in text:
            raise ReleaseError(f"the home page answered {status or 'nothing'}")

    def run(self):
        previous = self.live_commit()
        self.log(f"live commit before release: {previous or 'unknown'}")
        if previous == self.sha:
            self.log("this commit is already live; nothing to do")
            return 0
        try:
            deployment = self.deploy(self.sha)
            self.wait_for(deployment, self.sha)
            self.check_home()
        except ReleaseError as problem:
            self.log(f"::error::Release of {self.sha} failed: {problem}")
            return self.undo(previous)
        self.log(f"released {self.sha}: the site reports it and the home page loads")
        return 0

    def undo(self, previous):
        if not previous:
            self.log("::error::The live commit before the release is unknown, so nothing was put back. "
                     "Redeploy the last good commit from Coolify by hand.")
            return 1
        self.log(f"putting back {previous}")
        try:
            self.wait_for(self.deploy(previous), previous)
            self.check_home()
        except ReleaseError as problem:
            self.log(f"::error::Putting back {previous} also failed: {problem}. Check Coolify now.")
            return 1
        self.log(f"::error::The release failed and {previous} is live again.")
        return 1


def main():
    missing = [name for name in ("COOLIFY_URL", "COOLIFY_API_TOKEN", "COOLIFY_WEB_APP_UUID", "SITE_URL", "RELEASE_SHA")
               if not os.environ.get(name)]
    if missing:
        print(f"::error::Release is not set up: missing {', '.join(missing)} (docs/RELEASES.md). Nothing changed.")
        return 1
    try:
        return Release(os.environ).run()
    except ReleaseError as problem:
        print(f"::error::{problem}. Nothing changed.")
        return 1


if __name__ == "__main__":
    sys.exit(main())
