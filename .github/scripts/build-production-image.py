"""Build a profile-bound candidate only; never publish or deploy it."""
import os
import re
import subprocess
from public_build_profile import load_profile, verify_public_key, profile_digest


def main():
    revision = os.environ.get("RELEASE_SHA", "")
    if not re.fullmatch(r"[a-f0-9]{40}", revision):
        raise ValueError("A complete source revision is required")
    profile = load_profile()
    key = os.environ.get("BRITELINK_PUBLIC_ANON_KEY", "")
    verify_public_key(key, profile)
    values = {
        "BRITELINK_BUILD_COMMIT": revision,
        "BRITELINK_PUBLIC_CONFIG_SHA256": profile_digest(profile),
        "VITE_SUPABASE_URL": profile["apiOrigin"],
        "VITE_SUPABASE_ANON_KEY": key,
        "VITE_PRIVACY_NOTICE_VERSION": profile["privacyNoticeVersion"],
        "VITE_ATTACHMENTS_ENABLED": "true" if profile["attachmentsEnabled"] else "",
    }
    command = ["docker", "build"]
    for name, value in values.items():
        command += ["--build-arg", name + "=" + value]
    command += ["-t", "britelink:production-candidate", "."]
    try:
        subprocess.run(command, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=900)
    except Exception:
        raise RuntimeError("Production candidate build failed; public-key-bearing output withheld") from None
    print("Built reviewed-profile candidate; publication, runtime checks and deployment are separate")


if __name__ == "__main__":
    main()
