"""Extract the actual ZIP into a Chinese/spaced path, launch its CMD and run real Chrome regression."""
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import subprocess
import time
import urllib.request
import zipfile
from package_friends import ROOT, NAME, digest, write_json


def main():
    latest = ROOT / 'logs/phase-3/friend-package/latest.json'
    result = json.loads(latest.read_text(encoding='utf-8'))
    archive = Path(result['archive'])
    if digest(archive) != result['sha256']:
        raise ValueError('ZIP SHA mismatch')
    extracted = Path(result['directory']) / ('解压启动 测试 ' + dt.datetime.now().strftime('%H%M%S'))
    extracted.mkdir(exist_ok=False)
    with zipfile.ZipFile(archive) as z:
        names = z.namelist()
        if len(names) != len(set(names)) or z.testzip() is not None:
            raise ValueError('Invalid ZIP')
        for name in names:
            target = (extracted / name).resolve()
            if not name.startswith(NAME + '/') or '\\' in name or ':' in name or extracted.resolve() not in target.parents:
                raise ValueError('Unsafe ZIP path')
        z.extractall(extracted)
    package = extracted / NAME
    local = json.loads((ROOT / 'toolchains.local.json').read_text(encoding='utf-8'))
    manifest = json.loads((package / 'package-manifest.json').read_text(encoding='utf-8'))
    # Python independently verifies every extracted byte before executing the bundle.
    actual = {p.relative_to(package).as_posix() for p in package.rglob('*') if p.is_file()}
    if actual != set(manifest['files']) | {'package-manifest.json'}:
        raise ValueError('Extracted file set differs')
    for name, entry in manifest['files'].items():
        p = package / name
        if p.stat().st_size != entry['bytes'] or digest(p) != entry['sha256']:
            raise ValueError('Extracted hash mismatch: ' + name)
    if any('node_modules' in name or 'toolchains' in name or name.endswith('.ts') for name in actual):
        raise ValueError('Developer files leaked')
    smoke = {'started': dt.datetime.now().astimezone().isoformat(), 'status': 'STARTED', 'extracted': str(package), 'zipSha256': result['sha256'], 'checks': ['ZIP CRC, SHA256 and all extracted file hashes passed', 'Chinese and spaced extracted directory; no npm, sources or toolchains']}
    startup = subprocess.STARTUPINFO()
    startup.dwFlags |= subprocess.STARTF_USESHOWWINDOW
    startup.wShowWindow = subprocess.SW_HIDE
    url = 'http://127.0.0.1:4187'
    try:
        urllib.request.urlopen(url + '/__bureau_info', timeout=1)
    except Exception:
        pass
    else:
        raise ValueError('Test port occupied; will not stop an existing process')
    with (ROOT / 'logs/phase-3/friend-package/launch-extracted.log').open('wb') as out:
        # Execute the exact shipped launcher, not the workspace server or installed Node.
        command = [os.environ.get('ComSpec', 'C:/Windows/System32/cmd.exe'), '/d', '/c', '开始试玩.cmd', '--no-open']
        child = subprocess.Popen(command, cwd=package, stdout=out, stderr=out, startupinfo=startup)
        smoke['launcherPid'] = child.pid
        try:
            deadline = time.monotonic() + 25
            while True:
                if child.poll() is not None:
                    raise ValueError('Packaged launcher exited before ready')
                try:
                    info = json.load(urllib.request.urlopen(url + '/__bureau_info', timeout=1))
                    break
                except Exception:
                    if time.monotonic() > deadline:
                        raise TimeoutError('Packaged server not ready')
                    time.sleep(0.25)
            if info['packageId'] != digest(package / 'package-manifest.json'):
                raise ValueError('Wrong loopback server')
            smoke['checks'].append('Shipped Chinese CMD started bundled Node and exact package on loopback 4187')
            for name, entry in manifest['files'].items():
                if name.startswith('game/'):
                    with urllib.request.urlopen(url + '/' + name[5:], timeout=10) as r:
                        data = r.read()
                        if hashlib.sha256(data).hexdigest() != entry['sha256']:
                            raise ValueError('HTTP asset hash differs: ' + name)
                    req = urllib.request.Request(url + '/' + name[5:], method='HEAD')
                    with urllib.request.urlopen(req, timeout=10) as r:
                        if r.status != 200 or r.read() != b'':
                            raise ValueError('Invalid HEAD response')
            smoke['checks'].append('All 19 game assets served byte-exactly; HEAD responses have no body')
            env = dict(os.environ)
            env['FRIEND_PACKAGE_DIR'] = str(package)
            with (ROOT / 'logs/phase-3/friend-package/browser-extracted.log').open('wb') as browser_log:
                run = subprocess.run([local['node'], 'tools/verify_game.cjs'], cwd=ROOT, env=env, stdout=browser_log, stderr=browser_log, timeout=650, startupinfo=startup)
            browser = json.loads((ROOT / 'logs/phase-2/browser-game-latest.json').read_text(encoding='utf-8'))
            if run.returncode or browser.get('status') != 'BROWSER_GAME_PASSED' or browser.get('friendPackage', {}).get('packageId') != info['packageId']:
                raise ValueError('Packaged real Chrome regression failed')
            smoke['checks'].append('Real Chrome full ' + str(len(browser['checks'])) + '-check pointer regression on packaged server; five-wave win, research, all legacy saves, small screens')
            smoke['browserChecks'] = len(browser['checks'])
            smoke['browserScreenshots'] = len(browser['screenshots'])
            smoke['browserReport'] = str(Path(browser['logs']) / 'result.json')
            smoke['status'] = 'PACKAGE_LAUNCH_AND_BROWSER_PASSED'
        except Exception as error:
            smoke['status'] = 'PACKAGE_FAILED'
            smoke['error'] = type(error).__name__ + ': ' + str(error)
            raise
        finally:
            # Cleanup only the exact process tree started by this verification.
            try:
                cleanup = subprocess.run(['taskkill', '/PID', str(child.pid), '/T', '/F'], capture_output=True, timeout=30)
                child.wait(timeout=15)
                smoke['cleanupExitCode'] = cleanup.returncode
            except Exception as cleanup_error:
                # Preserve the original test failure and audit even if OS permissions block cleanup.
                smoke['cleanupError'] = type(cleanup_error).__name__ + ': ' + str(cleanup_error)
                smoke['status'] = 'PACKAGE_FAILED'
            smoke['finished'] = dt.datetime.now().astimezone().isoformat()
            write_json(ROOT / 'logs/phase-3/friend-package/launch-result.json', smoke)
            result['status'] = smoke['status']
            result['launchEvidence'] = str(ROOT / 'logs/phase-3/friend-package/launch-result.json')
            write_json(latest, result)
    if smoke.get('cleanupError'):
        raise RuntimeError('Verification process cleanup failed: ' + smoke['cleanupError'])
    result['status'] = smoke['status']
    result['launchEvidence'] = str(ROOT / 'logs/phase-3/friend-package/launch-result.json')
    write_json(latest, result)
    print(json.dumps(smoke, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    import sys
    sys.stdout.reconfigure(encoding='utf-8')
    main()
