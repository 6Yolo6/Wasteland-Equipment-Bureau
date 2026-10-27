"""Build the genuine Creator project; attach scripts ONLY with metadata emitted by Creator.

The initial import build is not gameplay success. Final build must include BureauRoot.
No TapTap plugin/SDK or production IDs are configured by this command.
"""
import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import uuid

ROOT = Path(__file__).resolve().parents[1]
GAME = ROOT / 'game'


def validate_output_name(value):
    if not isinstance(value, str) or not re.fullmatch(r'web-mobile(?:-[a-z0-9]+)*', value):
        raise ValueError('Invalid output name')
    return value


def build_parameter(output_name, scene_uuid):
    validate_output_name(output_name)
    if not isinstance(scene_uuid, str) or not re.fullmatch(r'[0-9a-fA-F-]{36}', scene_uuid):
        raise ValueError('Invalid scene UUID')
    return 'platform=web-mobile;debug=true;buildPath=project://build;outputName=' + output_name + ';startScene=' + scene_uuid


def collect_source_manifest(game):
    inputs = list((game / 'assets').rglob('*.ts')) + list((game / 'assets').rglob('*.scene'))
    inputs += list((game / 'settings').rglob('*.json')) + [game / 'package.json']
    return {p.relative_to(game).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(inputs) if p.is_file()}


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def script_id(output_name):
    meta_path = GAME / 'assets/scripts/presentation/BureauRoot.ts.meta'
    if not meta_path.is_file():
        raise RuntimeError('Creator has not imported BureauRoot.ts. No synthetic script metadata will be written.')
    meta = json.loads(meta_path.read_text(encoding='utf-8'))
    if meta.get('importer') != 'typescript' or not meta.get('uuid'):
        raise RuntimeError('Unexpected Creator script metadata')
    pattern = re.compile(r'''_RF\.push\(\s*\{\s*\}\s*,\s*["']([^"']+)["']\s*,\s*["']BureauRoot["']''')
    candidates = [GAME / 'build' / output_name / 'assets/main/index.js']
    programming = GAME / 'temp/programming'
    if programming.is_dir():
        for folder, dirs, files in os.walk(programming):
            dirs[:] = [d for d in dirs if d not in {'node_modules', '.git'}]
            candidates.extend(Path(folder) / file for file in files if file.endswith('.js'))
    for file in candidates:
        if file.is_file():
            text = file.read_text(encoding='utf-8', errors='replace')
            found = pattern.search(text)
            if found:
                return found.group(1), meta['uuid'], str(file)
    raise RuntimeError('Cannot find the actual Creator _RF registration for BureauRoot; attach via editor instead of guessing a class ID.')


def attach_scene(logs, output_name):
    class_id, asset_uuid, evidence = script_id(output_name)
    target = GAME / 'assets/Smoke.scene'
    original = target.read_bytes()
    scene = json.loads(original.decode('utf-8'))
    canvases = [(i, entry) for i, entry in enumerate(scene) if entry.get('__type__') == 'cc.Node' and entry.get('_name') == 'Canvas']
    if len(canvases) != 1:
        raise RuntimeError('Expected one editor-generated Canvas')
    canvas_id, canvas = canvases[0]
    if not any(scene[ref['__id__']].get('__type__') == class_id for ref in canvas['_components']):
        component = {'__type__': class_id, '_name': '', '_objFlags': 0, '__editorExtras__': {}, 'node': {'__id__': canvas_id}, '_enabled': True, '__prefab': None, '_id': str(uuid.uuid4())}
        canvas['_components'].append({'__id__': len(scene)})
        scene.append(component)
    canvas['_lpos'].update({'x': 360, 'y': 640})
    for entry in scene:
        if entry.get('__type__') == 'cc.UITransform' and entry.get('node', {}).get('__id__') == canvas_id:
            entry['_contentSize'].update({'width': 720, 'height': 1280})
        if entry.get('__type__') == 'cc.Camera':
            entry['_orthoHeight'] = 640
    (logs / 'scene-before-attach.json').write_bytes(original)
    write_json(target, scene)
    return {'class_id': class_id, 'asset_uuid': asset_uuid, 'registration_evidence': evidence, 'scene': str(target), 'original_sha256': hashlib.sha256(original).hexdigest(), 'attached_sha256': hashlib.sha256(target.read_bytes()).hexdigest()}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--timeout', type=int, default=600)
    parser.add_argument('--output-name', default='web-mobile')
    args = parser.parse_args()
    if not 30 <= args.timeout <= 900:
        raise ValueError('Timeout must be 30..900 seconds')
    validate_output_name(args.output_name)
    local = json.loads((ROOT / 'toolchains.local.json').read_text(encoding='utf-8'))
    package = json.loads((GAME / 'package.json').read_text(encoding='utf-8'))
    if package.get('creator', {}).get('version') != '3.8.8':
        raise RuntimeError('Unexpected editor version; review first')
    meta = json.loads((GAME / 'assets/Smoke.scene.meta').read_text(encoding='utf-8'))
    stamp = dt.datetime.now().astimezone().strftime('%Y%m%d-%H%M%S-%f')
    logs = ROOT / 'logs/phase-2' / ('creator-game-' + stamp)
    logs.mkdir(parents=True, exist_ok=False)
    command = [local['creator'], '--project', str(GAME), '--build', build_parameter(args.output_name, meta['uuid'])]
    env = dict(os.environ)
    env['PATH'] = str(Path(local['node']).parent) + os.pathsep + env.get('PATH', '')
    env.pop('ELECTRON_RUN_AS_NODE', None)
    startup = None
    if os.name == 'nt':
        startup = subprocess.STARTUPINFO()
        startup.dwFlags |= subprocess.STARTF_USESHOWWINDOW
        startup.wShowWindow = subprocess.SW_HIDE
    report = {'scope': 'Cocos Web Mobile development build ONLY, not a TapTap native or production package', 'command': command, 'logs': str(logs), 'status': 'STARTED', 'passes': []}
    write_json(logs / 'result.json', report)
    print(json.dumps(report, ensure_ascii=False, indent=2), flush=True)

    def build(label):
        with (logs / (label + '.stdout.log')).open('wb') as out, (logs / (label + '.stderr.log')).open('wb') as err:
            child = subprocess.Popen(command, cwd=str(GAME), env=env, stdout=out, stderr=err, startupinfo=startup)
            print(label + '_PID=' + str(child.pid), flush=True)
            try:
                code = child.wait(timeout=args.timeout)
            except subprocess.TimeoutExpired:
                # Only the exact child process tree launched by this tool is eligible.
                if os.name == 'nt':
                    subprocess.run(['taskkill', '/PID', str(child.pid), '/T', '/F'], capture_output=True, timeout=30)
                else:
                    child.kill()
                child.wait(timeout=30)
                raise
        report['passes'].append({'label': label, 'pid': child.pid, 'exit_code': code})
        write_json(logs / 'result.json', report)
        if code != 36:
            raise RuntimeError(label + ' Creator exit code: ' + str(code))

    try:
        # Refresh registration evidence even on a clean checkout with committed .meta files.
        build('import-build')
        report['attachment'] = attach_scene(logs, args.output_name)
        def source_manifest():
            return collect_source_manifest(GAME)
        before = source_manifest()
        build('game-build')
        after = source_manifest()
        report['source_unchanged_during_build'] = before == after
        write_json(logs / 'source-manifest.json', after)
        if before != after:
            raise RuntimeError('Source changed during the build; rebuild before claiming this artifact is current')
        output = GAME / 'build' / args.output_name
        index = output / 'index.html'
        if not index.is_file():
            raise RuntimeError('Missing build index.html')
        manifest = {p.relative_to(output).as_posix(): {'bytes': p.stat().st_size, 'sha256': hashlib.sha256(p.read_bytes()).hexdigest()} for p in sorted(output.rglob('*')) if p.is_file()}
        write_json(logs / 'build-manifest.json', manifest)
        report.update({'status': 'BUILD_PASSED', 'index_html': str(index), 'bytes': sum(p['bytes'] for p in manifest.values()), 'files': len(manifest), 'browser': 'NOT_RUN', 'taptap_native': 'NOT_RUN'})
    except Exception as error:
        report.update({'status': 'BUILD_FAILED', 'error': type(error).__name__ + ': ' + str(error)})
    report['finished_at'] = dt.datetime.now().astimezone().isoformat()
    write_json(logs / 'result.json', report)
    write_json(ROOT / 'logs/phase-2/creator-game-latest.json', report)
    print(json.dumps(report, ensure_ascii=False, indent=2), flush=True)
    return 0 if report['status'] == 'BUILD_PASSED' else 1


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    raise SystemExit(main())
