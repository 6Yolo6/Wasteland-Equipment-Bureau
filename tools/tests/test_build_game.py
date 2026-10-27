"""Offline build-tool unit tests; no Creator process or GUI is launched."""
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools'))
import build_game

class OutputSafetyTests(unittest.TestCase):
    def test_valid_output_names(self):
        for name in ('web-mobile','web-mobile-balanced','web-mobile-v3-check'):
            self.assertEqual(build_game.validate_output_name(name), name)

    def test_invalid_output_names_do_not_form_commands(self):
        for name in ('../web-mobile','web-mobile/../../assets','web-mobile;outputName=x','web-mobile\\x','web-mobile-','Web-mobile','',None):
            with self.assertRaises(ValueError):
                build_game.build_parameter(name,'0822d271-6d92-413c-b825-b1a492b95994')

    def test_build_parameter_selects_only_requested_output(self):
        parameter=build_game.build_parameter('web-mobile-balanced','0822d271-6d92-413c-b825-b1a492b95994')
        self.assertIn('outputName=web-mobile-balanced;',parameter)
        self.assertNotIn('outputName=web-mobile;',parameter)
        self.assertEqual(parameter.count('outputName='),1)
        with self.assertRaises(ValueError):
            build_game.build_parameter('web-mobile-balanced','uuid;debug=false')

class SourceSettingsTests(unittest.TestCase):
    def test_engine_settings_and_project_version_are_build_inputs(self):
        with tempfile.TemporaryDirectory(dir=ROOT/'logs/phase-3') as d:
            game=Path(d)
            (game/'assets').mkdir()
            (game/'settings/v2/packages').mkdir(parents=True)
            (game/'assets/file.ts').write_text('source', encoding='utf-8')
            settings=game/'settings/v2/packages/engine.json'
            settings.write_text('{}', encoding='utf-8')
            (game/'package.json').write_text('{}', encoding='utf-8')
            before=build_game.collect_source_manifest(game)
            self.assertEqual(set(before), {'assets/file.ts','settings/v2/packages/engine.json','package.json'})
            settings.write_text('{"cropped":true}', encoding='utf-8')
            self.assertNotEqual(before, build_game.collect_source_manifest(game))

class RegistrationEvidenceTests(unittest.TestCase):
    def fixture(self, directory):
        game=Path(directory)/'game'
        meta=game/'assets/scripts/presentation/BureauRoot.ts.meta'
        meta.parent.mkdir(parents=True)
        meta.write_text(json.dumps({'importer':'typescript','uuid':'8d73d4f6-1422-46b5-8a7a-e631cd2be7a3'}),encoding='utf-8')
        old=game/'build/web-mobile/assets/main/index.js'
        old.parent.mkdir(parents=True)
        old.write_text('_RF.push({}, "old-id", "BureauRoot");',encoding='utf-8')
        return game

    def test_missing_new_output_cannot_reuse_old_output(self):
        with tempfile.TemporaryDirectory(dir=ROOT/'logs/phase-3') as d:
            game=self.fixture(d)
            with patch.object(build_game,'GAME',game):
                with self.assertRaisesRegex(RuntimeError,'Cannot find'):
                    build_game.script_id('web-mobile-balanced')

    def test_new_output_registration_is_used(self):
        with tempfile.TemporaryDirectory(dir=ROOT/'logs/phase-3') as d:
            game=self.fixture(d)
            new=game/'build/web-mobile-balanced/assets/main/index.js'
            new.parent.mkdir(parents=True)
            new.write_text('_RF.push({}, "new-id", "BureauRoot");',encoding='utf-8')
            with patch.object(build_game,'GAME',game):
                class_id,uuid,evidence=build_game.script_id('web-mobile-balanced')
            self.assertEqual(class_id,'new-id')
            self.assertEqual(Path(evidence),new)

    def test_missing_metadata_is_not_synthesized(self):
        with tempfile.TemporaryDirectory(dir=ROOT/'logs/phase-3') as d:
            game=Path(d)/'empty';game.mkdir()
            with patch.object(build_game,'GAME',game):
                with self.assertRaisesRegex(RuntimeError,'not imported'):
                    build_game.script_id('web-mobile-balanced')
            self.assertFalse((game/'assets').exists())

if __name__=='__main__':
    unittest.main(verbosity=2)
