"""Download the Dashboard installer linked from the official Creator download page."""
import json
from pathlib import PurePosixPath
import re
import sys
import urllib.parse
from bootstrap_toolchains import get, download, save_new, LOG_ROOT, now

sys.stdout.reconfigure(encoding="utf-8")
with get("https://www.cocos.com/creator-download") as response:
    html = response.read(5000000).decode("utf-8")
encoded = re.findall(r'"(https:[^"]*CocosDashboard[^"]*\.exe)"', html)
urls = sorted(set(json.loads('"' + value + '"') for value in encoded))
if len(urls) != 1:
    raise SystemExit("Expected exactly one official Dashboard Windows installer URL")
url = urls[0]
version = re.search(r"CocosDashboard-v([0-9.]+)-win", url).group(1)
tool = {"id": "cocos-dashboard", "version": version, "url": url, "filename": PurePosixPath(urllib.parse.urlparse(url).path).name, "expected_sha256": None}
path, receipt = download(tool)
save_new(LOG_ROOT / "dashboard-download.json", {"checked_at": now(), "source_page": "https://www.cocos.com/creator-download", "download": receipt, "installer": str(path), "installation_status": "NOT_RUN"})
print(json.dumps(receipt, ensure_ascii=False, indent=2))
