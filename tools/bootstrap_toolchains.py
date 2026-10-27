"""Fetch and install official portable toolchains into a fixed D-drive directory.
No global PATH edits, registry writes, installers, or project creation.
"""
import argparse
import datetime as dt
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import subprocess
import sys
import time
import urllib.parse
import urllib.request
import zipfile

WORKSPACE = Path(__file__).resolve().parents[1]
TOOLCHAIN_ROOT = Path("D:/taptap/toolchains")
LOG_ROOT = WORKSPACE / "logs/phase-1/2026-10-14"
ALLOWED_HOSTS = {"www.cocos.com", "download.cocos.com", "app-res.tapimg.com", "developer.taptap.cn", "nodejs.org"}

def now():
    return dt.datetime.now().astimezone().isoformat()

def get(url):
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != "https" or parsed.hostname not in ALLOWED_HOSTS:
        raise ValueError("Unexpected download host: " + url)
    request = urllib.request.Request(url, headers={"User-Agent": "WastelandEquipmentBureau-ToolchainSetup/1.0"})
    result = urllib.request.urlopen(request, timeout=90)
    if urllib.parse.urlparse(result.url).hostname not in ALLOWED_HOSTS:
        result.close()
        raise ValueError("Unexpected redirect host")
    return result

def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()

def save_new(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("x", encoding="utf-8") as output:
        json.dump(value, output, ensure_ascii=False, indent=2)
        output.write("\n")

def plan():
    with get("https://www.cocos.com/creator-download") as response:
        raw = response.read(5000000)
    html = raw.decode("utf-8")
    urls = [json.loads('"' + value + '"') for value in re.findall(r'win32_url:"([^"]+)"', html)]
    creator_urls = sorted(set(url for url in urls if "/v3.8.8/" in url and url.endswith(".zip")))
    if len(creator_urls) != 1:
        raise RuntimeError("Cannot identify exactly one official Creator 3.8.8 Windows ZIP")
    releases = re.findall(r'class="header__title"[^>]*>(.*?)</div>\s*<div class="header__date"[^>]*>(.*?)</div>', html)
    checksums_url = "https://nodejs.org/download/release/latest-v24.x/SHASUMS256.txt"
    with get(checksums_url) as response:
        checksums = response.read(100000).decode("utf-8")
    node = re.findall(r"^([0-9a-f]{64})\s+(node-v(24\.[0-9]+\.[0-9]+)-win-x64\.zip)$", checksums, re.M)
    if len(node) != 1:
        raise RuntimeError("Cannot identify exactly one official Node 24 Windows ZIP")
    digest, filename, version = node[0]
    sources = json.loads((LOG_ROOT / "sources-platform.json").read_text(encoding="utf-8"))["sources"]
    engine = next(source for source in sources if source["id"] == "engine")
    adapters = sorted(set(link["url"] for link in engine["body_links"] if urllib.parse.urlparse(link["url"]).hostname == "app-res.tapimg.com" and link["url"].endswith(".zip")))
    if len(adapters) != 1:
        raise RuntimeError("Cannot identify exactly one official TapTap adapter ZIP")
    manifest = {
        "prepared_at": now(), "destination": str(TOOLCHAIN_ROOT),
        "destination_preexisted": TOOLCHAIN_ROOT.exists(),
        "policy": "Portable installs only; no global PATH edits or existing file overwrite. Creator/adapter hashes are locally recorded, not vendor signatures. Node archive is checked against official HTTPS SHASUMS256.txt.",
        "creator_download_page": {"url": "https://www.cocos.com/creator-download", "sha256": hashlib.sha256(raw).hexdigest(), "listed_releases": releases[:12]},
        "node_checksums": {"url": checksums_url, "sha256": hashlib.sha256(checksums.encode("utf-8")).hexdigest()},
        "tools": [
            {"id": "node", "version": version, "url": "https://nodejs.org/download/release/v" + version + "/" + filename, "filename": filename, "expected_sha256": digest, "subdir": "node-" + version},
            {"id": "cocos-creator", "version": "3.8.8", "url": creator_urls[0], "filename": PurePosixPath(urllib.parse.urlparse(creator_urls[0]).path).name, "expected_sha256": None, "subdir": "cocos-creator-3.8.8"},
            {"id": "taptap-adapter", "version": "1.2.2", "url": adapters[0], "filename": "taptap-adapter-1.2.2.zip", "expected_sha256": None, "subdir": "taptap-adapter-1.2.2", "activation": "Staged only. Import as local extension into future Cocos project after approval of phase 1."},
        ],
    }
    save_new(LOG_ROOT / "toolchain-plan.json", manifest)
    print(json.dumps(manifest, ensure_ascii=False, indent=2))

def download(tool):
    download_dir = TOOLCHAIN_ROOT / "downloads"
    download_dir.mkdir(parents=True, exist_ok=True)
    target = download_dir / tool["filename"]
    receipt = download_dir / (tool["filename"] + ".receipt.json")
    if target.exists():
        if not receipt.exists():
            raise FileExistsError("Refusing to replace unknown existing archive: " + str(target))
        previous = json.loads(receipt.read_text(encoding="utf-8"))
        actual = sha256(target)
        if previous["url"] != tool["url"] or previous["sha256"] != actual:
            raise RuntimeError("Existing archive does not match recorded provenance")
        if tool["expected_sha256"] and actual != tool["expected_sha256"]:
            raise RuntimeError("Official checksum mismatch")
        print("Reusing verified archive: " + str(target), flush=True)
        return target, previous
    partial = download_dir / (tool["filename"] + ".partial")
    if partial.exists():
        raise FileExistsError("Partial download preserved; inspect before retrying: " + str(partial))
    digest = hashlib.sha256()
    downloaded = 0
    started = time.monotonic()
    last_print = started
    with get(tool["url"]) as response:
        expected_size = int(response.headers.get("Content-Length", "0"))
        print("Downloading " + tool["id"] + ": " + str(expected_size) + " bytes from " + response.url, flush=True)
        with partial.open("xb") as destination:
            while True:
                block = response.read(1024 * 1024)
                if not block:
                    break
                destination.write(block)
                digest.update(block)
                downloaded += len(block)
                if time.monotonic() - last_print >= 5:
                    print(tool["id"] + ": " + str(round(downloaded / 2**20, 1)) + " MiB", flush=True)
                    last_print = time.monotonic()
        if expected_size and downloaded != expected_size:
            raise RuntimeError("Incomplete download")
        metadata = {"id": tool["id"], "version": tool["version"], "url": tool["url"], "final_url": response.url, "downloaded_at": now(), "bytes": downloaded, "sha256": digest.hexdigest(), "last_modified": response.headers.get("Last-Modified"), "expected_sha256": tool["expected_sha256"], "vendor_checksum_verified": bool(tool["expected_sha256"])}
    if tool["expected_sha256"] and metadata["sha256"] != tool["expected_sha256"]:
        raise RuntimeError("Official SHA-256 verification failed; archive is not installed")
    # Both paths are fixed files within the validated downloads directory; not a recursive move.
    partial.rename(target)
    save_new(receipt, metadata)
    print("Downloaded and hashed: " + str(target), flush=True)
    return target, metadata

def extract(tool, archive):
    target = (TOOLCHAIN_ROOT / tool["subdir"]).resolve()
    allowed = TOOLCHAIN_ROOT.resolve()
    if os.path.commonpath([str(allowed), str(target)]) != str(allowed):
        raise ValueError("Unexpected extraction target")
    marker = target / "toolchain-install-receipt.json"
    if target.exists():
        if marker.exists():
            receipt = json.loads(marker.read_text(encoding="utf-8"))
            if receipt["archive_sha256"] == sha256(archive):
                print("Reusing completed portable extraction: " + str(target), flush=True)
                return receipt
        raise FileExistsError("Refusing to extract over an existing or incomplete directory: " + str(target))
    with zipfile.ZipFile(archive) as bundle:
        items = bundle.infolist()
        total_size = sum(item.file_size for item in items)
        if total_size > 12 * 2**30 or len(items) > 250000:
            raise RuntimeError("Archive exceeds expected toolchain extraction limits")
        checked = []
        for item in items:
            name = item.filename.replace("\\", "/")
            parts = PurePosixPath(name)
            if parts.is_absolute() or ".." in parts.parts or any(":" in part for part in parts.parts):
                raise ValueError("Unsafe archive path")
            mode = item.external_attr >> 16
            if stat.S_ISLNK(mode):
                raise ValueError("Archive symlink not permitted")
            destination = (target / Path(*parts.parts)).resolve()
            if os.path.commonpath([str(target), str(destination)]) != str(target):
                raise ValueError("Archive path escapes extraction root")
            checked.append((item, destination))
        target.mkdir(parents=True)
        print("Extracting " + tool["id"] + ": " + str(len(items)) + " entries, " + str(round(total_size / 2**20, 1)) + " MiB", flush=True)
        for item, destination in checked:
            if item.is_dir():
                destination.mkdir(parents=True, exist_ok=True)
                continue
            destination.parent.mkdir(parents=True, exist_ok=True)
            with bundle.open(item) as source, destination.open("xb") as output:
                for block in iter(lambda: source.read(1024 * 1024), b""):
                    output.write(block)
        receipt = {"id": tool["id"], "version": tool["version"], "extracted_at": now(), "destination": str(target), "archive": str(archive), "archive_sha256": sha256(archive), "entry_count": len(items), "uncompressed_bytes": total_size, "activation": tool.get("activation", "Portable toolchain; PATH unchanged")}
        if tool["id"] == "taptap-adapter":
            packages = [item for item in items if item.filename.endswith("package.json") and len(PurePosixPath(item.filename).parts) <= 3 and "node_modules" not in item.filename and item.file_size < 200000]
            receipt["package_manifests"] = [{"path": item.filename, "package": json.loads(bundle.read(item).decode("utf-8-sig"))} for item in packages]
        save_new(marker, receipt)
    return receipt

def install():
    manifest = json.loads((LOG_ROOT / "toolchain-plan.json").read_text(encoding="utf-8"))
    if Path(manifest["destination"]).resolve() != TOOLCHAIN_ROOT.resolve():
        raise ValueError("Manifest target differs from fixed approved D-drive location")
    TOOLCHAIN_ROOT.mkdir(parents=True, exist_ok=True)
    results = {"started_at": now(), "root": str(TOOLCHAIN_ROOT), "results": []}
    for tool in manifest["tools"]:
        archive, receipt = download(tool)
        installed = extract(tool, archive)
        results["results"].append({"download": receipt, "installation": installed})
    results["finished_at"] = now()
    save_new(LOG_ROOT / "toolchain-install.json", results)
    print(json.dumps(results, ensure_ascii=False, indent=2))

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["plan", "install"])
    args = parser.parse_args()
    if args.action == "plan":
        plan()
    else:
        install()

if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
