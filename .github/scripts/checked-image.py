"""Preserve/verify the exact runtime image tested by CI; never deploy it."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tarfile

REPOSITORY = "camster91/britelink-mvp"
KIND = "runtime"




def import_tag(revision):
    return "britelink-checked-" + KIND + ":" + revision


def digest(path):
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def expected_revision():
    revision = os.environ.get("RELEASE_SHA", "")
    if not re.fullmatch(r"[a-f0-9]{40}", revision):
        raise ValueError("A complete checked commit is required")
    return revision


def image_configuration(config, revision):
    settings = config.get("config", {})
    if settings.get("Labels", {}).get("org.opencontainers.image.revision") != revision:
        raise ValueError("Image label differs from the checked commit")
    if "RELEASE_SHA=" + revision not in settings.get("Env", []):
        raise ValueError("Image runtime revision differs from the checked commit")
    if settings.get("User") not in (None, "", "root"):
        raise ValueError("Expected the standard nginx master startup identity")
    if settings.get("Entrypoint") != ["/docker-entrypoint.sh"] or settings.get("Cmd") != ["nginx", "-g", "daemon off;"]:
        raise ValueError("Unexpected application startup configuration")
    environment = dict(value.split("=", 1) for value in settings.get("Env", []) if "=" in value)
    if environment.get("BRITELINK_API_ORIGIN") != "" or environment.get("BRITELINK_API_ANON_KEY") != "":
        raise ValueError("This transport gate only accepts explicitly unconfigured demo images")



def verify(directory):
    revision = expected_revision()
    receipt = json.loads((directory / "receipt.json").read_text())
    if receipt.get("schema") != 1 or receipt.get("repository") != REPOSITORY or receipt.get("revision") != revision or receipt.get("kind") != KIND or receipt.get("build_mode") != "unconfigured-demo":
        raise ValueError("Receipt does not identify the checked repository and commit")
    if not re.fullmatch(r"sha256:[a-f0-9]{64}", receipt.get("image_id", "")):
        raise ValueError("Invalid immutable image ID")
    for variable, field in [("GITHUB_RUN_ID", "workflow_run_id"), ("GITHUB_RUN_ATTEMPT", "workflow_run_attempt")]:
        if os.environ.get(variable) and receipt.get(field) != os.environ[variable]:
            raise ValueError("Receipt does not belong to the expected CI run")
    archive = directory / "runtime-image.tar"
    if digest(archive) != receipt.get("archive_sha256"):
        raise ValueError("Image archive checksum mismatch")
    with tarfile.open(archive, "r") as bundle:
        # Read exact entries without extracting or executing archive content.
        manifest = json.load(bundle.extractfile("manifest.json"))
        if len(manifest) != 1:
            raise ValueError("Expected exactly one checked runtime image")
        if manifest[0].get("RepoTags") != [import_tag(revision)]:
            raise ValueError("Expected the unique checked-image import tag")
        config_bytes = bundle.extractfile(manifest[0]["Config"]).read()
        if "sha256:" + hashlib.sha256(config_bytes).hexdigest() != receipt["image_id"]:
            raise ValueError("Image configuration does not match the immutable image ID")
        image_configuration(json.loads(config_bytes), revision)
        if not manifest[0].get("Layers"):
            raise ValueError("Runtime image layers are missing")
        for layer in manifest[0]["Layers"]:
            if not bundle.getmember(layer).isfile():
                raise ValueError("Runtime image layer is not a regular archive entry")
    return receipt


def export(image, directory):
    revision = expected_revision()
    if os.environ.get("GITHUB_REPOSITORY", REPOSITORY) != REPOSITORY:
        raise ValueError("Unexpected source repository")
    images = json.loads(subprocess.check_output(["docker", "image", "inspect", image], text=True))
    if len(images) != 1:
        raise ValueError("Ambiguous runtime image")
    image_configuration({"config": images[0]["Config"]}, revision)
    directory.mkdir(parents=True, exist_ok=False)
    archive = directory / "runtime-image.tar"
    # Retain a unique import tag: containerd may expose a manifest digest as Id
    # after loading, while classic Docker exposes the configuration digest.
    tag = import_tag(revision)
    subprocess.run(["docker", "image", "tag", images[0]["Id"], tag], check=True)
    subprocess.run(["docker", "image", "save", "--output", str(archive), tag], check=True)
    receipt = {"schema": 1, "repository": REPOSITORY, "revision": revision, "kind": KIND, "build_mode": "unconfigured-demo",
               "image_id": images[0]["Id"], "archive_sha256": digest(archive),
               "workflow_run_id": os.environ.get("GITHUB_RUN_ID"),
               "workflow_run_attempt": os.environ.get("GITHUB_RUN_ATTEMPT")}
    (directory / "receipt.json").write_text(json.dumps(receipt, sort_keys=True) + "\n")
    return verify(directory)


def comparable_configuration(settings):
    # Older inspect APIs synthesize these non-image fields with type defaults.
    # Only remove exact defaults; a non-default value must still fail closed.
    # https://docs.docker.com/engine/deprecated/#non-standard-fields-in-image-inspect
    defaults = {"Hostname": "", "Domainname": "", "Image": "",
                "AttachStdin": False, "AttachStdout": False, "AttachStderr": False,
                "Tty": False, "OpenStdin": False, "StdinOnce": False}
    result = dict(settings)
    for field, default in defaults.items():
        if field in result:
            if type(result[field]) is not type(default) or result[field] != default:
                raise ValueError("Unexpected non-default legacy inspect field: " + field)
            del result[field]
    # Docker v29 omits empty/nil image fields that older APIs return explicitly.
    empty_fields = {"Cmd": [], "Entrypoint": [], "Env": [], "Labels": {},
                    "OnBuild": [], "User": "", "Volumes": {}, "WorkingDir": ""}
    for field, empty in empty_fields.items():
        if field in result and (result[field] is None or
                                (type(result[field]) is type(empty) and result[field] == empty)):
            del result[field]
    return result


def verify_loaded(directory, receipt):
    tag = import_tag(receipt["revision"])
    image = json.loads(subprocess.check_output(["docker", "image", "inspect", tag], text=True))[0]
    with tarfile.open(directory / "runtime-image.tar") as bundle:
        manifest = json.load(bundle.extractfile("manifest.json"))
        config = json.load(bundle.extractfile(manifest[0]["Config"]))
    if comparable_configuration(image["Config"]) != comparable_configuration(config["config"]) or image["RootFS"]["Layers"] != config["rootfs"]["diff_ids"]:
        loaded_config, saved_config = comparable_configuration(image["Config"]), comparable_configuration(config["config"])
        missing = object()
        fields = sorted(key for key in set(loaded_config) | set(saved_config) if loaded_config.get(key, missing) != saved_config.get(key, missing))
        raise ValueError("Loaded runtime configuration or filesystem differs from checked image; configuration fields=" + ",".join(fields) + "; layers_equal=" + str(image["RootFS"]["Layers"] == config["rootfs"]["diff_ids"]))
    if image["Architecture"] != config["architecture"] or image["Os"] != config["os"]:
        raise ValueError("Loaded image platform differs from checked image")
    image_configuration({"config": image["Config"]}, receipt["revision"])
    return image


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["export", "verify", "load"])
    parser.add_argument("--directory", required=True, type=Path)
    parser.add_argument("--image")
    args = parser.parse_args()
    receipt = export(args.image, args.directory) if args.action == "export" else verify(args.directory)
    if args.action == "load":
        subprocess.run(["docker", "image", "load", "--input", str(args.directory / "runtime-image.tar")], check=True)
        verify_loaded(args.directory, receipt)
    print(json.dumps({"status": "verified", **receipt}))


if __name__ == "__main__":
    main()
