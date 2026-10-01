import base64
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from public_build_profile import load_profile, profile_digest, verify_public_key

spec = importlib.util.spec_from_file_location("production_builder", Path(__file__).with_name("build-production-image.py"))
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


def public_token(role="anon", expiry=2700000000):
    encode = lambda value: base64.urlsafe_b64encode(json.dumps(value).encode()).decode().rstrip("=")
    return encode({"alg": "HS256", "typ": "JWT"}) + "." + encode({"role": role, "exp": expiry}) + "." + base64.urlsafe_b64encode(b"x" * 32).decode().rstrip("=")


class PublicProfile(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "profile.json"
        self.key = public_token()
        self.profile = {"schema": 1, "repository": "camster91/britelink-mvp", "apiOrigin": "https://api.example.test", "anonKeySha256": hashlib.sha256(self.key.encode()).hexdigest(), "privacyNoticeVersion": "", "attachmentsEnabled": False}
        self.env = patch.dict(os.environ, {}, clear=True)
        self.env.start()
        self.save(self.profile)

    def tearDown(self):
        self.env.stop()
        self.temp.cleanup()

    def save(self, profile):
        self.path.write_text(json.dumps(profile), encoding="utf-8")
        os.environ.update(BRITELINK_PUBLIC_PROFILE_FILE=str(self.path), BRITELINK_PUBLIC_PROFILE_SHA256=profile_digest(profile))

    def test_reviewed_profile_accepts_public_key_without_promoting_features(self):
        profile = load_profile()
        verify_public_key(self.key, profile)
        self.assertEqual(profile["privacyNoticeVersion"], "")
        self.assertIs(profile["attachmentsEnabled"], False)

    def test_refuses_changed_profile_missing_identity_or_extra_secret_field(self):
        changed = dict(self.profile, privacyNoticeVersion="unreviewed")
        self.path.write_text(json.dumps(changed), encoding="utf-8")
        self.assertRaises(ValueError, load_profile)
        for name in ("BRITELINK_PUBLIC_PROFILE_FILE", "BRITELINK_PUBLIC_PROFILE_SHA256"):
            self.save(self.profile)
            del os.environ[name]
            self.assertRaises(ValueError, load_profile)
        self.save(dict(self.profile, serviceKey="must-never-be-accepted"))
        self.assertRaises(ValueError, load_profile)

    def test_rejects_nonproduction_origins_and_noncanonical_flags(self):
        for origin in ("http://api.example.test", "https://127.0.0.1", "https://localhost", "https://api.example.test/path", "https://user:password@api.example.test", "https://api.example.test?x=1", "https://api.example.test#x"):
            self.save(dict(self.profile, apiOrigin=origin))
            self.assertRaises(ValueError, load_profile)
        for changed in ({"attachmentsEnabled": "true"}, {"schema": True}, {"repository": "foreign/repo"}, {"privacyNoticeVersion": "not\na-version"}):
            self.save(dict(self.profile, **changed))
            self.assertRaises(ValueError, load_profile)

    def test_rejects_service_role_expired_malformed_or_changed_public_keys(self):
        for key in (public_token("service_role"), public_token(expiry=1), "sb_secret_bad", "not.a.jwt", public_token(expiry=True), public_token(expiry=float("nan")), public_token(expiry=float("inf")), public_token().rsplit(".", 1)[0] + ".YQ"):
            profile = dict(self.profile, anonKeySha256=hashlib.sha256(key.encode()).hexdigest())
            self.assertRaises(ValueError, verify_public_key, key, profile)
        self.assertRaises(ValueError, verify_public_key, public_token("authenticated"), self.profile)

    def test_builder_passes_only_reviewed_public_values_and_never_publishes(self):
        os.environ.update(RELEASE_SHA="a" * 40, BRITELINK_PUBLIC_ANON_KEY=self.key)
        with patch.object(builder.subprocess, "run") as run:
            builder.main()
        command = run.call_args.args[0]
        self.assertEqual(command[:2], ["docker", "build"])
        for value in ("VITE_SUPABASE_URL=https://api.example.test", "VITE_PRIVACY_NOTICE_VERSION=", "VITE_ATTACHMENTS_ENABLED=", "BRITELINK_PUBLIC_CONFIG_SHA256=" + profile_digest(self.profile)):
            self.assertIn(value, command)
        self.assertEqual(run.call_count, 1)
        os.environ["BRITELINK_PUBLIC_ANON_KEY"] = "changed"
        with patch.object(builder.subprocess, "run") as run:
            self.assertRaises(ValueError, builder.main)
            run.assert_not_called()

    def test_failed_build_does_not_expose_child_exception_or_public_key(self):
        os.environ.update(RELEASE_SHA="a" * 40, BRITELINK_PUBLIC_ANON_KEY=self.key)
        with patch.object(builder.subprocess, "run", side_effect=RuntimeError("sensitive command " + self.key)):
            with self.assertRaises(RuntimeError) as failure:
                builder.main()
        self.assertNotIn(self.key, str(failure.exception))
        self.assertIsNone(failure.exception.__cause__)


if __name__ == "__main__":
    unittest.main()
