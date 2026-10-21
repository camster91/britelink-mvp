#!/usr/bin/env python3
"""Tests for coolify_release.py against a fake Coolify and a fake live site."""
import json
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from coolify_release import Release, ReleaseError  # noqa: E402

OLD = "a" * 40
NEW = "b" * 40
ENV = {
    "COOLIFY_URL": "https://coolify.example/",
    "COOLIFY_API_TOKEN": "secret-token",
    "COOLIFY_WEB_APP_UUID": "web-app",
    "SITE_URL": "https://site.example",
    "RELEASE_SHA": NEW,
}


class FakeWorld:
    """Coolify pins a commit and deploys it; the site then serves it unless that commit is 'broken'."""

    def __init__(self, live=OLD, broken=(), deploy_state="finished", home_ok=True):
        self.live = live
        self.pinned = None
        self.broken = set(broken)
        self.deploy_state = deploy_state
        self.home_ok = home_ok
        self.calls = []
        self.tokens = set()

    def call(self, method, url, token=None, body=None, timeout=30):
        self.calls.append((method, url.split("?")[0], body))
        if url.startswith("https://coolify.example/api/v1"):
            self.tokens.add(token)
            path = url[len("https://coolify.example/api/v1"):]
            if method == "PATCH" and path == "/applications/web-app":
                self.pinned = body["git_commit_sha"]
                return 200, "{}"
            if method == "GET" and path.startswith("/deploy?uuid=web-app"):
                return 200, json.dumps({"deployments": [{"deployment_uuid": f"dep-{self.pinned[:4]}"}]})
            if method == "GET" and path.startswith("/deployments/"):
                state = self.deploy_state if self.pinned == NEW else "finished"
                if state == "finished" and self.pinned not in self.broken:
                    self.live = self.pinned
                return 200, json.dumps({"status": state})
            return 404, "{}"
        self.tokens.add(token)
        if url.startswith("https://site.example/version.json"):
            return 200, json.dumps({"commit": self.live})
        if url == "https://site.example/":
            ok = self.home_ok or self.live != NEW
            return (200, '<html><div id="root"></div></html>') if ok else (502, "bad gateway")
        return 404, ""


def run(world, **extra):
    clock = iter(range(0, 10_000_000, 15))
    lines = []
    code = Release({**ENV, **extra}, call=world.call, sleep=lambda _: None, clock=lambda: next(clock), log=lines.append).run()
    return code, lines


class ReleaseTests(unittest.TestCase):
    def test_a_healthy_release_goes_live(self):
        world = FakeWorld()
        code, lines = run(world)
        self.assertEqual(code, 0)
        self.assertEqual(world.live, NEW)
        self.assertEqual(world.pinned, NEW)
        self.assertIn(f"released {NEW}: the site reports it and the home page loads", lines)

    def test_the_token_only_goes_to_coolify(self):
        world = FakeWorld()
        run(world)
        site_calls = [c for c in world.calls if c[1].startswith("https://site.example")]
        self.assertTrue(site_calls)
        self.assertEqual(world.tokens, {"secret-token", None})

    def test_a_failed_build_puts_the_old_commit_back(self):
        world = FakeWorld(deploy_state="failed")
        code, lines = run(world)
        self.assertEqual(code, 1)
        self.assertEqual(world.live, OLD)
        self.assertEqual(world.pinned, OLD)
        self.assertIn(f"::error::The release failed and {OLD} is live again.", lines)

    def test_a_release_that_never_shows_up_is_undone(self):
        world = FakeWorld(broken={NEW})
        code, lines = run(world)
        self.assertEqual(code, 1)
        self.assertEqual(world.pinned, OLD)
        self.assertTrue(any("did not report" in line for line in lines))

    def test_a_broken_home_page_is_undone(self):
        world = FakeWorld(home_ok=False)
        code, _ = run(world)
        self.assertEqual(code, 1)
        self.assertEqual(world.live, OLD)

    def test_an_unknown_previous_commit_is_reported_not_guessed(self):
        world = FakeWorld(live="unknown", deploy_state="failed")
        code, lines = run(world)
        self.assertEqual(code, 1)
        self.assertEqual(world.pinned, NEW, "nothing else was deployed")
        self.assertTrue(any("is unknown, so nothing was put back" in line for line in lines))

    def test_an_already_live_commit_changes_nothing(self):
        world = FakeWorld(live=NEW)
        code, _ = run(world)
        self.assertEqual(code, 0)
        self.assertIsNone(world.pinned)

    def test_a_hand_started_run_rebuilds_the_live_commit(self):
        world = FakeWorld(live=NEW)
        code, lines = run(world, FORCE_RELEASE="true")
        self.assertEqual(code, 0)
        self.assertEqual(world.pinned, NEW, "Coolify was asked to deploy it again")
        self.assertIn(f"released {NEW}: the site reports it and the home page loads", lines)

    def test_a_failed_rebuild_of_the_live_commit_says_so(self):
        world = FakeWorld(live=NEW, deploy_state="failed")
        code, lines = run(world, FORCE_RELEASE="true")
        self.assertEqual(code, 1)
        self.assertTrue(any("no older commit to put back" in line for line in lines))

    def test_a_bad_sha_is_refused(self):
        with self.assertRaises(ReleaseError):
            Release({**ENV, "RELEASE_SHA": "main"})


if __name__ == "__main__":
    unittest.main()
