"""Offline package input gates; no real runtime/editor/browser launch."""
from pathlib import Path
from copy import deepcopy
import sys
import tempfile
import unittest
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools'))
from package_friends import validate_build, validate_browser_evidence, digest

class PackageGateTests(unittest.TestCase):
    def fixture(self, directory):
        output = Path(directory)
        (output / 'cocos-js').mkdir()
        (output / 'cocos-js/cc.js').write_text("System.register([], function() {});", encoding='utf-8')
        (output / 'index.html').write_text('<html></html>', encoding='utf-8')
        return output

    def test_clean_cropped_build_and_hash(self):
        with tempfile.TemporaryDirectory(dir=ROOT / 'logs/phase-3') as d:
            output = self.fixture(d)
            self.assertEqual(validate_build(output), 2)
            self.assertEqual(len(digest(output / 'index.html')), 64)

    def test_unwanted_runtime_map_and_private_files_rejected(self):
        for name in ['spine.js', 'dragonbones.wasm', 'index.js.map', 'toolchains.local.json', '.env']:
            with tempfile.TemporaryDirectory(dir=ROOT / 'logs/phase-3') as d:
                output = self.fixture(d)
                (output / name).write_text('x', encoding='utf-8')
                with self.assertRaisesRegex(ValueError, 'Unwanted'):
                    validate_build(output)

    def test_private_absolute_path_rejected(self):
        for path in ['D:/taptap/private.js', 'C:/Users/Administrator/private.js', 'D:\\taptap\\private.js']:
            with tempfile.TemporaryDirectory(dir=ROOT / 'logs/phase-3') as d:
                output = self.fixture(d)
                (output / 'index.js').write_text(path, encoding='utf-8')
                with self.assertRaisesRegex(ValueError, 'Private'):
                    validate_build(output)

    def test_hidden_spine_export_rejected(self):
        with tempfile.TemporaryDirectory(dir=ROOT / 'logs/phase-3') as d:
            output = self.fixture(d)
            (output / 'cocos-js/cc.js').write_text("exports('sp', Spine);", encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'Uncropped'):
                validate_build(output)

class BrowserEvidenceTests(unittest.TestCase):
    def fixture(self):
        build = {'logs': str(ROOT / 'logs/phase-2/fixture-build')}
        evidence = {'build': {'output': 'fixture', 'bytes': 123}, 'compiled': {'compiler': '4.9.5', 'outputFiles': 20}}
        checks = ['Wave ' + str(wave) + ' pending supply: verified' for wave in range(1, 5)]
        checks += ['Research pointer flow: verified', 'Research new run: verified',
                   'Five real rendered waves won with configured mvp-0.4.1-dev-all rules']
        checks += ['Equipment unlock entry: verified']
        checks += ['Legacy 0.4 ' + mode + ' ' + phase + ': verified' for mode in ['research', 'sandbox'] for phase in ['combat', 'loot', 'settlement-claimed']]
        checks += ['other regression'] * 26
        browser = {'status': 'BROWSER_GAME_PASSED', 'buildEvidence': build['logs'],
                   'evidenceGate': {'build': deepcopy(evidence['build']), 'compilation': deepcopy(evidence['compiled'])},
                   'checks': checks, 'playthrough': {'victories': 5, 'phase': 'settlement', 'settlement': {'baseCoins': 32}}}
        for field in ['pageErrors', 'consoleErrors', 'httpErrors', 'requestFailures', 'externalRequests']:
            browser[field] = []
        return browser, build, evidence

    def test_exact_current_browser_evidence_passes(self):
        browser, build, evidence = self.fixture()
        validate_browser_evidence(browser, build, evidence)

    def test_missing_supply_or_research_coverage_rejected_even_with_enough_checks(self):
        for prefix in ['Wave ' + str(wave) + ' pending supply:' for wave in range(1, 5)] + ['Research pointer flow:', 'Research new run:', 'Equipment unlock entry:'] + ['Legacy 0.4 ' + mode + ' ' + phase + ':' for mode in ['research', 'sandbox'] for phase in ['combat', 'loot', 'settlement-claimed']]:
            with self.subTest(prefix=prefix):
                browser, build, evidence = self.fixture()
                browser['checks'] = ['irrelevant check' if check.startswith(prefix) else check for check in browser['checks']]
                with self.assertRaisesRegex(ValueError, 'coverage'):
                    validate_browser_evidence(browser, build, evidence)

    def test_stale_compilation_build_version_and_incomplete_win_rejected(self):
        browser, build, evidence = self.fixture()
        invalid = []
        for field, value in [('status', 'BROWSER_GAME_FAILED'), ('buildEvidence', str(ROOT / 'other-build'))]:
            modified = deepcopy(browser); modified[field] = value; invalid.append(modified)
        modified = deepcopy(browser); modified['evidenceGate']['build']['bytes'] += 1; invalid.append(modified)
        modified = deepcopy(browser); modified['evidenceGate']['compilation']['compiler'] = 'stale'; invalid.append(modified)
        modified = deepcopy(browser); modified['checks'] = [check.replace('mvp-0.4.1', 'mvp-0.3.0') for check in modified['checks']]; invalid.append(modified)
        modified = deepcopy(browser); modified['playthrough']['victories'] = 4; invalid.append(modified)
        modified = deepcopy(browser); modified['playthrough']['phase'] = 'defeat'; invalid.append(modified)
        modified = deepcopy(browser); modified['playthrough']['settlement']['baseCoins'] = 0; invalid.append(modified)
        for modified in invalid:
            with self.subTest(browser=modified):
                with self.assertRaises(ValueError):
                    validate_browser_evidence(modified, build, evidence)

    def test_browser_faults_and_missing_fault_lists_rejected(self):
        for field in ['pageErrors', 'consoleErrors', 'httpErrors', 'requestFailures', 'externalRequests']:
            for faults in [['failure'], None]:
                with self.subTest(field=field, faults=faults):
                    browser, build, evidence = self.fixture()
                    browser[field] = faults
                    with self.assertRaisesRegex(ValueError, 'Browser fault'):
                        validate_browser_evidence(browser, build, evidence)

if __name__ == '__main__':
    unittest.main(verbosity=2)
