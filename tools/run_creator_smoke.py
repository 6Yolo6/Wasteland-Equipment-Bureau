"""Build a copy of the user-created Creator smoke project. Never modify the original.

Uses the documented Creator --project / --build flags; exit 36 means success.
This is a Web Mobile environment test, NOT a TapTap package or gameplay test.
"""
import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'verification' / 'EngineSmoke'
COPY_ENTRIES = ('package.json', 'tsconfig.json', 'assets', 'settings', '.creator', 'extensions')
EXCLUDED = {'.git', 'node_modules', 'library', 'temp', 'profiles', 'build', 'bin', 'obj', 'dist', 'target'}


def write_json(path, value, exclusive=False):
    with path.open('x' if exclusive else 'w', encoding='utf-8') as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.write('\n')


def ensure_inside(path, parent):
    path, parent = path.resolve(), parent.resolve()
    if path == parent or os.path.commonpath([str(path), str(parent)]) != str(parent):
        raise ValueError('Path must be strictly inside allowed parent: ' + str(path))
    return path


def is_link(path):
    attributes = getattr(path.lstat(), 'st_file_attributes', 0)
    return path.is_symlink() or bool(attributes & getattr(stat, 'FILE_ATTRIBUTE_REPARSE_POINT', 0))


def source_files():
    result = []
    def walk(path):
        if is_link(path):
            raise ValueError('Refusing symlink/reparse point: ' + str(path))
        ensure_inside(path, SOURCE)
        if path.is_dir():
            for entry in sorted(path.iterdir()):
                if entry.name not in EXCLUDED:
                    walk(entry)
        elif path.is_file():
            result.append(path)
        else:
            raise ValueError('Unsupported filesystem entry: ' + str(path))
    for name in COPY_ENTRIES:
        path = SOURCE / name
        if path.exists():
            walk(path)
    return result


def file_manifest(files):
    return {path.relative_to(SOURCE).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest() for path in files}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--build', action='store_true', help='Launch Creator; otherwise only prepare an isolated copy')
    parser.add_argument('--timeout', type=int, default=600)
    args = parser.parse_args()
    if not 30 <= args.timeout <= 900:
        raise ValueError('Timeout must be 30..900 seconds')
    ensure_inside(SOURCE, ROOT / 'verification')
    if is_link(SOURCE):
        raise ValueError('Refusing a linked project directory')
    config = json.loads((ROOT / 'toolchains.local.json').read_text(encoding='utf-8'))
    package = json.loads((SOURCE / 'package.json').read_text(encoding='utf-8'))
    if package.get('creator', {}).get('version') != '3.8.8':
        raise ValueError('Unexpected Creator project version; review before building')
    scene_file = SOURCE / 'assets' / 'Smoke.scene'
    scene = json.loads(scene_file.read_text(encoding='utf-8'))
    meta = json.loads(scene_file.with_suffix('.scene.meta').read_text(encoding='utf-8'))
    if not isinstance(scene, list) or not any(row.get('__type__') == 'cc.Scene' for row in scene):
        raise ValueError('Saved scene is missing a cc.Scene object')
    if meta.get('importer') != 'scene' or not meta.get('uuid'):
        raise ValueError('Missing authentic scene importer metadata')
    started = dt.datetime.now().astimezone()
    label = started.strftime('%Y%m%d-%H%M%S-%f')
    copy = ensure_inside(ROOT / 'verification' / ('EngineSmoke-web-' + label), ROOT / 'verification')
    logs = ROOT / 'logs' / 'phase-1' / started.strftime('%Y-%m-%d') / ('creator-build-' + label)
    copy.mkdir(exist_ok=False)
    logs.mkdir(parents=True, exist_ok=False)
    files = source_files()
    before = file_manifest(files)
    for source in files:
        target = ensure_inside(copy / source.relative_to(SOURCE), copy)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(str(source), str(target))
    for empty_directory in ('assets', 'settings'):
        (copy / empty_directory).mkdir(exist_ok=True)
    write_json(logs / 'source-manifest-before.json', before, exclusive=True)
    options = 'platform=web-mobile;debug=true;buildPath=project://build;outputName=web-mobile;startScene=' + meta['uuid']
    command = [config['creator'], '--project', str(copy), '--build', options]
    report = {'started_at': started.isoformat(), 'scope': 'Real copied Creator project, Web Mobile environment smoke ONLY; not TapTap, gameplay or ads', 'source': str(SOURCE), 'copy': str(copy), 'logs': str(logs), 'scene_uuid': meta['uuid'], 'files_copied': len(files), 'command': command, 'success_exit_code': 36, 'status': 'PREPARED_NOT_RUN'}
    write_json(logs / 'result.json', report, exclusive=True)
    print(json.dumps(report, ensure_ascii=False, indent=2), flush=True)
    if not args.build:
        return 0
    env = dict(os.environ)
    env['PATH'] = str(Path(config['node']).parent) + os.pathsep + env.get('PATH', '')
    # Electron applications must not inherit a shell's run-as-Node override.
    env.pop('ELECTRON_RUN_AS_NODE', None)
    startup = None
    if os.name == 'nt':
        startup = subprocess.STARTUPINFO()
        startup.dwFlags |= subprocess.STARTF_USESHOWWINDOW
        startup.wShowWindow = subprocess.SW_HIDE
    process = None
    try:
        with (logs / 'creator.stdout.log').open('wb') as stdout, (logs / 'creator.stderr.log').open('wb') as stderr:
            process = subprocess.Popen(command, cwd=str(copy), env=env, stdout=stdout, stderr=stderr, startupinfo=startup)
            report.update({'status': 'RUNNING', 'pid': process.pid})
            write_json(logs / 'result.json', report)
            print('CREATOR_PID=' + str(process.pid), flush=True)
            try:
                code = process.wait(timeout=args.timeout)
            except subprocess.TimeoutExpired:
                report['status'] = 'TIMEOUT'
                if os.name == 'nt' and process.poll() is None:
                    cleanup = subprocess.run(['taskkill', '/PID', str(process.pid), '/T', '/F'], capture_output=True, timeout=30)
                    (logs / 'timeout-cleanup.log').write_bytes(cleanup.stdout + cleanup.stderr)
                elif process.poll() is None:
                    process.kill()
                process.wait(timeout=30)
                raise
            report['exit_code'] = code
            index = copy / 'build' / 'web-mobile' / 'index.html'
            report['index_html'] = str(index)
            report['index_exists'] = index.is_file()
            report['status'] = 'BUILD_PASSED' if code == 36 and index.is_file() else 'BUILD_FAILED'
    except Exception as error:
        if report['status'] != 'TIMEOUT':
            report['status'] = 'BUILD_EXCEPTION'
        report['error'] = type(error).__name__ + ': ' + str(error)
    finally:
        after = file_manifest(source_files())
        write_json(logs / 'source-manifest-after.json', after, exclusive=True)
        report['source_unchanged'] = before == after
        if before != after:
            report['status'] = 'SOURCE_CHANGED_DURING_AUDIT'
        report['finished_at'] = dt.datetime.now().astimezone().isoformat()
        write_json(logs / 'result.json', report)
        print(json.dumps(report, ensure_ascii=False, indent=2), flush=True)
    return 0 if report['status'] == 'BUILD_PASSED' else 1


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    raise SystemExit(main())
