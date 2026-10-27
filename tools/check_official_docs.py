"""Inspect public official documentation. Store metadata and hashes, not page copies."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import datetime as dt
import hashlib
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import re
import sys
import urllib.parse
import urllib.request

SOURCES = {
    "guide": "https://developer.taptap.cn/minigameapidoc/quick-start/document-guide/",
    "engine": "https://developer.taptap.cn/minigameapidoc/dev/engine/Cocos-Laya-Egret/",
    "iaa": "https://developer.taptap.cn/minigameapidoc/quick-start/monetization/IAA-game/",
    "ad-policy": "https://developer.taptap.cn/minigameapidoc/tap-operation/operation-standards/minigame-ad-policy/",
    "mcp-ads": "https://developer.taptap.cn/minigameapidoc/quick-start/mcp-guide/ad-integration-guide/",
    "development": "https://developer.taptap.cn/minigameapidoc/quick-start/guide/dev/",
    "creation": "https://developer.taptap.cn/minigameapidoc/quick-start/guide/creation-improvement/",
    "login-management": "https://developer.taptap.cn/minigameapidoc/dev/tutorial/open-capabilities/login-management/",
    "login": "https://developer.taptap.cn/minigameapidoc/dev/api/open-api/login/tap.login/",
    "check-session": "https://developer.taptap.cn/minigameapidoc/dev/api/open-api/login/tap.checkSession/",
    "code2session": "https://developer.taptap.cn/minigameapidoc/dev/server/login/code2Session/",
    "game-config": "https://developer.taptap.cn/minigameapidoc/dev/dev-support/config/",
    "rewarded-video": "https://developer.taptap.cn/minigameapidoc/dev/tutorial/open-capabilities/ad/rewarded-video-ad/",
    "rewarded-create": "https://developer.taptap.cn/minigameapidoc/dev/api/ad/tap.createRewardedVideoAd/",
    "rewarded-object": "https://developer.taptap.cn/minigameapidoc/dev/api/ad/RewardedVideoAd/",
    "rewarded-close": "https://developer.taptap.cn/minigameapidoc/dev/api/ad/RewardedVideoAd.onClose/",
    "rewarded-show": "https://developer.taptap.cn/minigameapidoc/dev/api/ad/RewardedVideoAd.show/",
    "rewarded-load": "https://developer.taptap.cn/minigameapidoc/dev/api/ad/RewardedVideoAd.load/",
    "rewarded-error": "https://developer.taptap.cn/minigameapidoc/dev/api/ad/RewardedVideoAd.onError/",
    "rewarded-destroy": "https://developer.taptap.cn/minigameapidoc/dev/api/ad/RewardedVideoAd.destroy/",
    "dirichlet-mini": "https://ssp.dirichlet.cn/docs/mini-program-guide/",
    "creator-download": "https://www.cocos.com/creator-download",
    "creator-install": "https://docs.cocos.com/creator/3.8/manual/zh/getting-started/install/",
    "pre-filing": "https://developer.taptap.cn/minigameapidoc/quick-start/guide/pre-filing/",
}

class Content(HTMLParser):
    VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}
    BLOCK = {"h1", "h2", "h3", "h4", "h5", "p", "li", "tr", "pre", "br", "div", "section", "table", "ul", "ol"}
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.depth = 0
        self.level = None
        self.parts = []
        self.links = []
        self.all_links = []
        self.title = []
        self.in_title = False
        self.hidden_depth = 0
        self.anchor = None
    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag not in self.VOID:
            self.depth += 1
        if tag == "title":
            self.in_title = True
        if tag in {"script", "style"}:
            self.hidden_depth += 1
        classes = set(attrs.get("class", "").split())
        if self.level is None and classes.intersection({"theme-default-content", "vp-doc", "theme-doc-markdown"}):
            self.level = self.depth
        if tag == "a" and attrs.get("href"):
            self.anchor = {"href": attrs["href"], "label": "", "content": self.level is not None}
        if self.level is not None and tag in self.BLOCK:
            self.parts.append("\n")
    def handle_data(self, data):
        if self.in_title:
            self.title.append(data)
        if self.level is not None and not self.hidden_depth:
            self.parts.append(data)
        if self.anchor is not None:
            self.anchor["label"] += data
    def handle_endtag(self, tag):
        if tag in {"script", "style"}:
            self.hidden_depth = max(0, self.hidden_depth - 1)
        if tag == "title":
            self.in_title = False
        if tag == "a" and self.anchor is not None:
            self.all_links.append(self.anchor)
            if self.anchor["content"]:
                self.links.append(self.anchor)
            self.anchor = None
        if self.level is not None:
            if tag in self.BLOCK:
                self.parts.append("\n")
            if self.depth == self.level:
                self.level = None
        if tag not in self.VOID:
            self.depth = max(0, self.depth - 1)
    def text(self):
        lines = [re.sub(r"[ \t\r\f\v]+", " ", line).strip() for line in "".join(self.parts).split("\n")]
        return "\n".join(line for line in lines if line)

def fetch(entry):
    key, url = entry
    metadata = {"id": key, "requested_url": url, "checked_at": dt.datetime.now().astimezone().isoformat()}
    text = ""
    try:
        request = urllib.request.Request(url, headers={"User-Agent": "WastelandEquipmentBureau-Phase1-DocCheck/1.0"})
        with urllib.request.urlopen(request, timeout=30) as response:
            raw = response.read(5000000)
            metadata.update({"status": response.status, "final_url": response.url, "last_modified": response.headers.get("Last-Modified"), "etag": response.headers.get("ETag"), "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()})
            parser = Content()
            parser.feed(raw.decode("utf-8", errors="replace"))
            text = parser.text()
            metadata.update({"title": "".join(parser.title), "body_characters": len(text), "body_sha256": hashlib.sha256(text.encode("utf-8")).hexdigest(), "body_extracted": bool(text), "body_links": [{"url": urllib.parse.urljoin(response.url, link["href"]), "label": link["label"].strip()} for link in parser.links], "navigation_links": [{"url": urllib.parse.urljoin(response.url, link["href"]), "label": link["label"].strip()} for link in parser.all_links if not link["content"] and re.search(r"调试|测试|登录|配置|下载|离线|存储|防沉迷|审核|广告|隐私", link["label"])]})
    except Exception as error:
        metadata["error"] = str(error)
    return metadata, text

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--ids", default="guide,engine,development,creation")
    parser.add_argument("--output")
    parser.add_argument("--show-body", action="store_true")
    parser.add_argument("--url", help="Additional official documentation URL; result id is custom")
    args = parser.parse_args()
    requested = [(key, SOURCES[key]) for key in args.ids.split(",") if key]
    if args.url:
        if urllib.parse.urlparse(args.url).hostname not in {"developer.taptap.cn", "ssp.dirichlet.cn", "docs.cocos.com", "www.cocos.com", "nodejs.org"}:
            raise SystemExit("Only approved public official documentation hosts are supported")
        requested.append(("custom", args.url))
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(fetch, requested))
    metadata = [item[0] for item in results]
    if args.output:
        workspace = Path(__file__).resolve().parents[1]
        output = (workspace / args.output).resolve()
        if os.path.commonpath([str(workspace), str(output)]) != str(workspace):
            raise SystemExit("Output must stay inside the workspace")
        output.parent.mkdir(parents=True, exist_ok=True)
        with output.open("x", encoding="utf-8") as target:
            json.dump({"scope": "HTTP reachability, parsed body and source hashes only. Not an API runtime or integration test. Last-Modified is not a policy effective date.", "sources": metadata}, target, ensure_ascii=False, indent=2)
            target.write("\n")
    for info, body in results:
        print("\n=== " + info["id"] + " ===")
        print(json.dumps({key: value for key, value in info.items() if key not in ("navigation_links", "body_links")}, ensure_ascii=False, indent=2))
        if args.show_body:
            print(body or "[No supported article body extracted; review separately]")
            print("BODY LINKS: " + json.dumps([link for link in info.get("body_links", []) if urllib.parse.urlparse(link["url"]).fragment == ""], ensure_ascii=False))
    if any("error" in item for item in metadata):
        raise SystemExit(1)

if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
