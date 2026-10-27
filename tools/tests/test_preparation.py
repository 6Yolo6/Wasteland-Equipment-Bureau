"""Tests for phase-1 preparation utilities only. These are NOT game tests."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import unittest
import uuid

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools"))
from check_official_docs import Content
from bootstrap_toolchains import get, save_new, sha256

class ArticleParserTests(unittest.TestCase):
    def parse(self, source):
        parser = Content()
        parser.feed(source)
        return parser

    def test_vuepress_article_excludes_navigation(self):
        page = self.parse('<nav>not article</nav><div class="theme-default-content"><h1>Heading</h1><p>Body</p></div><footer>not article</footer>')
        self.assertEqual(page.text(), 'Heading\nBody')

    def test_vitepress_article(self):
        page = self.parse('<main><div class="vp-doc extra"><h1>Creator</h1><p>Content</p></div></main>')
        self.assertEqual(page.text(), 'Creator\nContent')

    def test_docusaurus_article(self):
        page = self.parse('<article><div class="theme-doc-markdown markdown"><p>Dirichlet</p><div><p>Nested content</p></div></div></article>')
        self.assertEqual(page.text(), 'Dirichlet\nNested content')

    def test_style_and_script_are_not_body_content(self):
        page = self.parse('<div class="vp-doc"><style>body {x:y}</style><p>Shown</p><script>notContent()</script></div>')
        self.assertEqual(page.text(), 'Shown')

    def test_unknown_layout_does_not_claim_body(self):
        page = self.parse('<title>Title only</title><div>Unknown layout</div>')
        self.assertEqual(page.text(), '')
        self.assertEqual(''.join(page.title), 'Title only')

    def test_article_links_are_separate_from_navigation(self):
        page = self.parse('<nav><a href="/nav">Navigation</a></nav><div class="vp-doc"><a href="/actual">Actual API</a><br><p>Next</p></div>')
        self.assertEqual(len(page.all_links), 2)
        self.assertEqual(len(page.links), 1)
        self.assertEqual(page.links[0]['href'], '/actual')
        self.assertEqual(page.links[0]['label'], 'Actual API')

class DownloadSafetyTests(unittest.TestCase):
    def test_plain_http_is_rejected_before_network(self):
        with self.assertRaises(ValueError):
            get('http://download.cocos.com/example.zip')

    def test_unapproved_host_is_rejected_before_network(self):
        with self.assertRaises(ValueError):
            get('https://example.invalid/tool.zip')

    def test_existing_report_is_not_overwritten(self):
        directory = ROOT / 'logs/phase-1/2026-10-14/fixtures' / uuid.uuid4().hex
        directory.mkdir(parents=True)
        destination = directory / 'exclusive-write.json'
        save_new(destination, {'original': '保留'})
        with self.assertRaises(FileExistsError):
            save_new(destination, {'replacement': True})
        self.assertEqual(json.loads(destination.read_text(encoding='utf-8')), {'original': '保留'})

    def test_archive_hash_helper_has_known_reference(self):
        directory = ROOT / 'logs/phase-1/2026-10-14/fixtures' / uuid.uuid4().hex
        directory.mkdir(parents=True)
        destination = directory / 'hash-reference.bin'
        destination.write_bytes(b'abc')
        self.assertEqual(sha256(destination), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')

class ToolRunnerTests(unittest.TestCase):
    def test_info_reports_installed_absolute_paths(self):
        result = subprocess.run([sys.executable, str(ROOT / 'tools/run_tool.py'), 'info'], capture_output=True, encoding='utf-8', timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)
        config = json.loads(result.stdout)
        for key in ('node', 'npmCli', 'creator', 'dashboard', 'adb', 'python'):
            self.assertTrue(Path(config[key]).is_absolute(), key)
            self.assertTrue(Path(config[key]).is_file(), key)

    def test_invalid_tool_fails_without_launch(self):
        result = subprocess.run([sys.executable, str(ROOT / 'tools/run_tool.py'), 'unsupported'], capture_output=True, encoding='utf-8', timeout=10)
        self.assertEqual(result.returncode, 2)
        self.assertIn('Usage:', result.stdout)

if __name__ == '__main__':
    unittest.main(verbosity=2)
