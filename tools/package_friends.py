"""Create an offline Windows x64 friend playtest ZIP from hash-gated, browser-passed output."""
import datetime as dt
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[1]
NAME = 'Wasteland-Bureau-0.4.1-Win64'


def digest(file):
    return hashlib.sha256(Path(file).read_bytes()).hexdigest()


def validate_build(output):
    files = [p for p in output.rglob('*') if p.is_file()]
    if any(p.is_symlink() for p in output.rglob('*')):
        raise ValueError('Build symlink rejected')
    for p in files:
        name = p.relative_to(output).as_posix().lower()
        if any(x in name for x in ['spine', 'dragonbone', '.map', '.env', 'toolchains', 'node_modules']):
            raise ValueError('Unwanted build file: ' + name)
        if p.suffix in {'.js', '.json', '.html', '.css'}:
            text = p.read_text(encoding='utf-8')
            if re.search(r'[A-Za-z]:[\\/](?:Users|taptap)[\\/]', text, re.I):
                raise ValueError('Private absolute path in build: ' + name)
    cc = (output / 'cocos-js/cc.js').read_text(encoding='utf-8')
    for marker in ["exports('sp'", 'spine_umd', 'sp.Skeleton', 'dragonBones =', 'Spine Runtimes License']:
        if marker in cc:
            raise ValueError('Uncropped runtime: ' + marker)
    return len(files)


def write_json(file, value):
    file.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def validate_browser_evidence(browser, build, evidence):
    """Require this build's complete 0.4 gameplay pass, not an older counted smoke run."""
    if browser.get('status') != 'BROWSER_GAME_PASSED' or Path(browser.get('buildEvidence', '')).resolve() != Path(build['logs']).resolve():
        raise ValueError('Full browser pass must refer to this exact Creator build')
    if browser.get('evidenceGate', {}).get('build') != evidence['build']:
        raise ValueError('Browser build evidence mismatch')
    if browser.get('evidenceGate', {}).get('compilation') != evidence['compiled']:
        raise ValueError('Browser compilation evidence mismatch')
    for field in ['pageErrors', 'consoleErrors', 'httpErrors', 'requestFailures', 'externalRequests']:
        if browser.get(field) != []:
            raise ValueError('Browser fault: ' + field)
    checks = browser.get('checks', [])
    playthrough = browser.get('playthrough', {})
    if not isinstance(checks, list) or not all(isinstance(check, str) for check in checks) or len(checks) < 33:
        raise ValueError('Incomplete browser playthrough')
    if playthrough.get('victories') != 5 or playthrough.get('phase') != 'settlement' or playthrough.get('settlement', {}).get('baseCoins') != 32:
        raise ValueError('Incomplete browser playthrough')
    required = ['Wave ' + str(wave) + ' pending supply:' for wave in range(1, 5)]
    required += ['Research pointer flow:', 'Research new run:', 'Equipment unlock entry:']
    required += ['Legacy 0.4 ' + mode + ' ' + phase + ':' for mode in ['research', 'sandbox'] for phase in ['combat', 'loot', 'settlement-claimed']]
    if any(not any(check.startswith(prefix) for check in checks) for prefix in required):
        raise ValueError('Missing 0.4 supply/research browser coverage')
    if not any('Five real rendered waves won with configured mvp-0.4.1-dev-all rules' in check for check in checks):
        raise ValueError('Wrong gameplay version in browser evidence')


def main():
    local = json.loads((ROOT / 'toolchains.local.json').read_text(encoding='utf-8'))
    build = json.loads((ROOT / 'logs/phase-2/creator-game-latest.json').read_text(encoding='utf-8'))
    browser_file = ROOT / 'logs/phase-2/browser-game-latest.json'
    browser = json.loads(browser_file.read_text(encoding='utf-8'))
    reports = [p for p in (ROOT / 'logs/phase-2').glob('browser-game-*/result.json') if json.loads(p.read_text(encoding='utf-8')).get('started') == browser.get('started')]
    if len(reports) != 1:
        raise ValueError('Cannot locate exact browser report')
    browser_directory = reports[0].parent
    # Reuse the read-only complete source/output gates; no browser or Creator launches here.
    code = "const r=process.cwd();const b=require('./logs/phase-2/creator-game-latest.json');const e=require('./tools/lib/build-evidence.cjs');console.log(JSON.stringify({build:e.verifyBuildEvidence(r,b),compiled:e.verifyCompiledEvidence(r)}));"
    gate = subprocess.run([local['node'], '-e', code], cwd=ROOT, capture_output=True, check=True, text=True, encoding='utf-8')
    evidence = json.loads(gate.stdout)
    output = Path(evidence['build']['output'])
    validate_browser_evidence(browser, build, evidence)
    validate_build(output)
    engine = Path(local['creator']).parent / 'resources/resources/3d/engine'
    cfg = json.loads((ROOT / 'game/settings/v2/packages/engine.json').read_text(encoding='utf-8'))
    if any(x in cfg['modules']['configs'][cfg['modules']['globalConfigKey']]['includeModules'] for x in ['spine', 'spine-3.8', 'spine-4.2', 'dragon-bones']):
        raise ValueError('Skeleton runtime must be officially cropped')
    node = Path(local['node'])
    version = subprocess.check_output([str(node), '--version'], text=True).strip()
    if version != 'v24.21.0':
        raise ValueError('Review different bundled Node version before packaging')
    pe = node.read_bytes(); pe_offset = int.from_bytes(pe[60:64], 'little')
    if pe[:2] != b'MZ' or pe[pe_offset:pe_offset+4] != b'PE\x00\x00' or pe[pe_offset+4:pe_offset+6] != b'\x64\x86':
        raise ValueError('Node executable is not Windows x64')
    stamp = dt.datetime.now().astimezone().strftime('%Y%m%d-%H%M%S-%f')
    directory = ROOT / 'dist/friends' / stamp
    package = directory / NAME
    package.mkdir(parents=True, exist_ok=False)
    shutil.copytree(output, package / 'game')
    (package / 'runtime').mkdir()
    shutil.copyfile(node, package / 'runtime/node.exe')
    shutil.copyfile(node.parent / 'LICENSE', package / 'runtime/Node-LICENSE.txt')
    template = ROOT / 'tools/portable'
    for name in ['server.cjs', 'Start.cmd', '试玩说明.txt']:
        shutil.copyfile(template / name, package / name)
    shutil.copyfile(template / 'Start.cmd', package / '开始试玩.cmd')
    shutil.copytree(template / 'licenses', package / 'licenses')
    entries = {p.relative_to(package).as_posix(): {'bytes': p.stat().st_size, 'sha256': digest(p)} for p in sorted(package.rglob('*')) if p.is_file()}
    build_manifest = Path(build['logs']) / 'build-manifest.json'
    manifest = {'format': 1, 'app': 'wasteland-bureau-friend-playtest', 'version': '0.4.1', 'contentVersion': 'mvp-0.4.1-dev-all', 'platform': 'windows-x64', 'port': 4187, 'created': dt.datetime.now().astimezone().isoformat(), 'files': entries,
        'provenance': {'creator': '3.8.8', 'node': version, 'compiler': evidence['compiled']['compiler'], 'buildFiles': build['files'], 'buildBytes': build['bytes'], 'buildManifestSha256': digest(build_manifest), 'engineSettingsSha256': digest(ROOT / 'game/settings/v2/packages/engine.json'), 'browserReportSha256': digest(browser_file), 'browserChecks': len(browser['checks']), 'browserScreenshots': len(browser['screenshots']), 'browserFinished': browser['finished'], 'fiveWaveVictories': 5, 'spineDragonBonesRuntimeIncluded': False}}
    write_json(package / 'package-manifest.json', manifest)
    # Integrity gate runs from standalone bundled server code, without npm packages.
    check = "const s=require(process.argv[1]);s.verifyPackage(require('node:path').dirname(process.argv[1]));console.log('PACKAGE_INTEGRITY_PASSED');"
    subprocess.run([str(package / 'runtime/node.exe'), '-e', check, str(package / 'server.cjs')], check=True)
    archive = directory / (NAME + '.zip')
    with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        for p in sorted(package.rglob('*')):
            if p.is_file():
                z.write(p, NAME + '/' + p.relative_to(package).as_posix())
    with zipfile.ZipFile(archive) as z:
        if z.testzip() is not None:
            raise ValueError('ZIP CRC test failed')
    checksum = archive.with_suffix('.zip.sha256.txt')
    checksum.write_text(digest(archive) + '  ' + archive.name + '\n', encoding='ascii')
    result = {'status': 'PACKAGE_CREATED_NOT_YET_LAUNCH_TESTED', 'directory': str(directory), 'package': str(package), 'archive': str(archive), 'checksum': str(checksum), 'sha256': digest(archive), 'zipBytes': archive.stat().st_size, 'uncompressedBytes': sum(e['bytes'] for e in entries.values()) + (package / 'package-manifest.json').stat().st_size, 'files': len(entries) + 1, 'buildEvidence': build['logs'], 'browserEvidence': str(browser_directory)}
    write_json(ROOT / 'logs/phase-3/friend-package/latest.json', result)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    import sys
    sys.stdout.reconfigure(encoding='utf-8')
    main()
