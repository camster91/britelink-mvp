"""Bind an image to reviewed browser settings without storing its public JWT here."""
import base64
import hashlib
import json
import math
import os
from pathlib import Path
import re
import time
from urllib.parse import urlsplit

REPOSITORY = "camster91/britelink-mvp"


def profile_digest(profile):
    return hashlib.sha256(json.dumps(profile, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()).hexdigest()


def load_profile():
    path = os.environ.get("BRITELINK_PUBLIC_PROFILE_FILE", "")
    expected = os.environ.get("BRITELINK_PUBLIC_PROFILE_SHA256", "")
    if not path or not re.fullmatch(r"[a-f0-9]{64}", expected):
        raise ValueError("A reviewed public profile file and digest are required")
    profile = json.loads(Path(path).read_text(encoding="utf-8"))
    fields = {"schema", "repository", "apiOrigin", "anonKeySha256", "privacyNoticeVersion", "attachmentsEnabled"}
    if set(profile) != fields or type(profile["schema"]) is not int or profile["schema"] != 1 or profile["repository"] != REPOSITORY:
        raise ValueError("Unexpected public profile schema or repository")
    origin = profile["apiOrigin"]
    if not isinstance(origin, str):
        raise ValueError("A public HTTPS API origin is required")
    parsed = urlsplit(origin)
    if parsed.scheme != "https" or not parsed.hostname or parsed.hostname in ("localhost", "127.0.0.1", "::1") or parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment or parsed.port not in (None, 443):
        raise ValueError("The production API must be an HTTPS origin without a path or credentials")
    if not isinstance(profile["anonKeySha256"], str) or not re.fullmatch(r"[a-f0-9]{64}", profile["anonKeySha256"]):
        raise ValueError("A reviewed public anon-key digest is required")
    if not isinstance(profile["privacyNoticeVersion"], str) or not re.fullmatch(r"[A-Za-z0-9._-]{0,80}", profile["privacyNoticeVersion"]):
        raise ValueError("Invalid privacy notice version")
    if type(profile["attachmentsEnabled"]) is not bool:
        raise ValueError("Attachment availability must be explicitly reviewed")
    if profile_digest(profile) != expected:
        raise ValueError("Public profile differs from its reviewed digest")
    return profile


def verify_public_key(key, profile):
    # Signature equivalence to the real backend is an operator preflight: its
    # private signing key must never reach an image build or GitHub runner.
    if not isinstance(key, str) or hashlib.sha256(key.encode()).hexdigest() != profile["anonKeySha256"]:
        raise ValueError("Public anon key differs from the reviewed profile")
    try:
        parts = key.split(".")
        if len(parts) != 3 or not all(re.fullmatch(r"[A-Za-z0-9_-]+", part) for part in parts):
            raise ValueError()
        decode = lambda part: json.loads(base64.urlsafe_b64decode(part + "=" * (-len(part) % 4)))
        header, payload = decode(parts[0]), decode(parts[1])
        signature = base64.urlsafe_b64decode(parts[2] + "=" * (-len(parts[2]) % 4))
        if len(signature) != 32 or header.get("alg") != "HS256" or payload.get("role") != "anon" or type(payload.get("exp")) not in (int, float) or not math.isfinite(payload["exp"]) or payload["exp"] <= time.time():
            raise ValueError()
    except Exception:
        raise ValueError("A valid unexpired public anon JWT is required") from None
