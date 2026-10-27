"""Prepare a separate adapter copy using the vendor lockfile, without lifecycle scripts."""
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import urllib.parse

ROOT = Path(__file__).resolve().parents[1]
TOOLS = Path('D:/taptap/toolchains').resolve()
SOURCE = (TOOLS / 'taptap-adapter-1.2.2/taptap-minigame-tools').resolve()
TARGET = (TOOLS / 'taptap-adapter-1.2.2-ready/taptap-minigame-tools').resolve()
LOG = ROOT / 'logs/phase-1/2026-10-14'

def ensure_child(path):
    if os.path.commonpath([str(TOOLS), str(path.resolve())]) != str(TOOLS) or path.resolve() == TOOLS:
        raise ValueError('Target is outside the explicitly named toolchain directory')

def main():
    ensure_child(SOURCE)
    ensure_child(TARGET)
    if TARGET.exists():
        raise FileExistsError('Refusing to overwrite an existing configured adapter: ' + str(TARGET))
    lock_path = SOURCE / 'converter/package-lock.json'
    lock_bytes = lock_path.read_bytes()
    lock = json.loads(lock_bytes)
    for package in lock.get('packages', {}).values():
        if package.get('resolved'):
            url = urllib.parse.urlparse(package['resolved'])
            if url.scheme != 'https' or url.hostname != 'registry.npmjs.org':
                raise ValueError('Vendor lockfile includes an unexpected download origin')
    config_path = ROOT / 'toolchains.local.json'
    config = json.loads(config_path.read_text(encoding='utf-8'))
    if Path(config['adapter']).resolve() != SOURCE:
        raise ValueError('Local adapter selection changed; refusing to replace it')
    shutil.copytree(SOURCE, TARGET)
    converter = (TARGET / 'converter').resolve()
    dependency_directory = (converter / 'node_modules').resolve()
    # npm ci replaces this dependency tree. Check its final absolute destination before invoking it.
    ensure_child(dependency_directory)
    if dependency_directory.parent != converter:
        raise ValueError('Unexpected dependency directory')
    cache = (TOOLS / 'npm-cache').resolve()
    user_config = (TOOLS / 'npm-config-for-adapter-ci.ini').resolve()
    ensure_child(cache)
    ensure_child(user_config)
    if user_config.exists():
        raise FileExistsError('Refusing to overwrite npm configuration')
    user_config.write_text('registry=https://registry.npmjs.org/\nignore-scripts=true\naudit=false\nfund=false\n', encoding='utf-8')
    command = [config['node'], config['npmCli'], 'ci', '--ignore-scripts', '--include=dev', '--no-audit', '--no-fund', '--registry=https://registry.npmjs.org/', '--cache=' + str(cache), '--userconfig=' + str(user_config)]
    env = dict(os.environ)
    env['PATH'] = str(Path(config['node']).parent) + os.pathsep + env.get('PATH', '')
    print('Preserved original adapter: ' + str(SOURCE), flush=True)
    print('Prepared copy: ' + str(TARGET), flush=True)
    print('Verified npm-ci replacement target: ' + str(dependency_directory), flush=True)
    started = dt.datetime.now().astimezone().isoformat()
    result = subprocess.run(command, cwd=str(converter), env=env, capture_output=True, timeout=240)
    (LOG / 'adapter-dependency-install.stdout.log').write_bytes(result.stdout)
    (LOG / 'adapter-dependency-install.stderr.log').write_bytes(result.stderr)
    record = {'started_at': started, 'finished_at': dt.datetime.now().astimezone().isoformat(), 'source': str(SOURCE), 'configured_copy': str(TARGET), 'replaced_dependency_tree': str(dependency_directory), 'command': command, 'return_code': result.returncode, 'original_lock_sha256': hashlib.sha256(lock_bytes).hexdigest(), 'configured_lock_sha256': hashlib.sha256((converter / 'package-lock.json').read_bytes()).hexdigest(), 'lifecycle_scripts_disabled': True, 'game_or_extension_execution': 'NOT_RUN'}
    (LOG / 'adapter-dependency-setup.json').write_text(json.dumps(record, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(result.stdout.decode('utf-8', errors='replace'))
    print(result.stderr.decode('utf-8', errors='replace'))
    if result.returncode:
        raise SystemExit(result.returncode)
    if record['original_lock_sha256'] != record['configured_lock_sha256']:
        raise RuntimeError('Vendor lockfile unexpectedly changed')
    config['originalAdapter'] = config['adapter']
    config['adapter'] = str(TARGET).replace('\\', '/')
    config_path.write_text(json.dumps(config, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(record, ensure_ascii=False, indent=2))

if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    main()
