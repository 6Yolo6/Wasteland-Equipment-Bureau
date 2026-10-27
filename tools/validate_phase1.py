"""Run actual phase-1 utility tests and preparation checks; never claim game tests ran."""
import ast
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import urllib.parse

ROOT = Path(__file__).resolve().parents[1]
LOG_ROOT = ROOT / 'logs/phase-1/2026-10-14'
CHECKS = []

def record(name, action):
    try:
        detail = action()
        CHECKS.append({'check': name, 'status': 'PASS', 'detail': detail})
    except Exception as error:
        CHECKS.append({'check': name, 'status': 'FAIL', 'detail': str(error)})

def require(condition, message):
    if not condition:
        raise AssertionError(message)

def digest(path):
    value = hashlib.sha256()
    with path.open('rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            value.update(block)
    return value.hexdigest()

def main():
    started = dt.datetime.now().astimezone()
    run_dir = LOG_ROOT / ('validation-' + started.strftime('%H%M%S'))
    run_dir.mkdir(parents=True, exist_ok=False)
    config = json.loads((ROOT / 'toolchains.local.json').read_text(encoding='utf-8'))

    def unit_tests():
        env = dict(os.environ)
        env['PYTHONIOENCODING'] = 'utf-8'
        env['PYTHONDONTWRITEBYTECODE'] = '1'
        command = [sys.executable, '-m', 'unittest', 'discover', '-s', 'tools/tests', '-v']
        result = subprocess.run(command, cwd=str(ROOT), capture_output=True, encoding='utf-8', env=env, timeout=90)
        (run_dir / 'preparation-unit-tests.stdout.log').write_text(result.stdout, encoding='utf-8')
        (run_dir / 'preparation-unit-tests.stderr.log').write_text(result.stderr, encoding='utf-8')
        print(result.stdout + result.stderr)
        require(result.returncode == 0, 'Preparation utility tests failed; see unit-test logs')
        match = re.search(r'Ran (\d+) tests?', result.stderr)
        require(match is not None, 'No unittest test-count result')
        return {'scope': 'Preparation utilities ONLY; not game or reward business tests', 'tests_run': int(match.group(1)), 'return_code': result.returncode, 'command': command}
    record('准备工具单元测试（不属于玩法测试）', unit_tests)

    def syntax():
        paths = sorted((ROOT / 'tools').glob('*.py')) + sorted((ROOT / 'tools/tests').glob('*.py'))
        for path in paths:
            ast.parse(path.read_text(encoding='utf-8'), filename=str(path))
        return {'python_files_checked': len(paths)}
    record('准备脚本 Python 语法检查', syntax)

    def paths():
        for key in ('node', 'npmCli', 'creator', 'dashboard', 'adb', 'python'):
            require(Path(config[key]).is_absolute() and Path(config[key]).is_file(), 'Missing tool: ' + key)
        require(Path(config['adapter']).is_dir(), 'Missing staged adapter')
        return 'All configured installed tool paths exist; game project is intentionally not included'
    record('已配置工具的绝对路径检查', paths)

    def command_check(name, args, expected):
        command = [sys.executable, str(ROOT / 'tools/run_tool.py'), name] + args
        result = subprocess.run(command, cwd=str(ROOT), capture_output=True, timeout=30)
        stdout = result.stdout.decode('utf-8', errors='replace').strip()
        stderr = result.stderr.decode('utf-8', errors='replace').strip()
        (run_dir / (name + '-version.json')).write_text(json.dumps({'command': command, 'return_code': result.returncode, 'stdout': stdout, 'stderr': stderr}, ensure_ascii=False, indent=2), encoding='utf-8')
        require(result.returncode == 0 and expected in stdout, 'Version probe failed: ' + stdout + stderr)
        return stdout
    record('隔离 Node.js 实际版本命令', lambda: command_check('node', ['--version'], 'v24.21.0'))
    record('隔离 npm 实际版本命令', lambda: command_check('npm', ['--version'], '11.19.0'))
    record('已有 ADB 实际版本命令（未连接设备）', lambda: command_check('adb', ['version'], '36.0.0-13206524'))

    windows = json.loads((LOG_ROOT / 'toolchain-verification-windows.json').read_text(encoding='utf-8-sig'))
    def creator_version():
        require(windows['fileVersion'] == '3.8.8' and windows['productVersion'] == '3.8.8', 'Unexpected Creator PE metadata')
        return {'version': windows['fileVersion'], 'observed_at': windows['checkedAt'], 'not_a_gui_test': True}
    record('已执行的 Creator PE 版本核验记录', creator_version)
    def creator_signature():
        require(windows['signatureStatus'] == 'Valid', 'Creator signature not valid')
        return {'status': windows['signatureStatus'], 'publisher': windows['signerSubject'], 'observed_at': windows['checkedAt']}
    record('已执行的 Creator 数字签名核验记录', creator_signature)

    dashboard_evidence = {}
    def dashboard_installation():
        dashboard_evidence.update(json.loads((LOG_ROOT / 'dashboard-installed.json').read_text(encoding='utf-8')))
        require(Path(dashboard_evidence['dashboardPath']).resolve() == Path(config['dashboard']).resolve(), 'Dashboard path differs from observed installation')
        require(dashboard_evidence['fileVersion'] == '2.2.2' and dashboard_evidence['productVersion'] == '2.2.2', 'Unexpected Dashboard PE version')
        require(dashboard_evidence['signatureStatus'] == 'Valid', 'Dashboard signature evidence not valid')
        require(len(dashboard_evidence['runningProcesses']) > 0, 'No recorded running Dashboard process')
        return {'version': '2.2.2', 'signature': 'Valid', 'observed_at': dashboard_evidence['checkedAt'], 'running_processes_at_observation': len(dashboard_evidence['runningProcesses']), 'login': dashboard_evidence['loginStatus'], 'scope': 'Recorded binary/process observation only, not a GUI or login test'}
    record('已执行的 Dashboard 版本/签名/进程核验记录', dashboard_installation)

    installed = json.loads((LOG_ROOT / 'toolchain-install.json').read_text(encoding='utf-8'))
    def archive_integrity():
        details = []
        for tool in installed['results']:
            actual = digest(Path(tool['installation']['archive']))
            require(actual == tool['download']['sha256'], 'Archive changed: ' + tool['download']['id'])
            official = tool['download']['expected_sha256']
            if official:
                require(actual == official, 'Vendor checksum mismatch')
            details.append({'id': tool['download']['id'], 'sha256': actual, 'compared_to_official_sha256': bool(official)})
        return details
    record('三个下载归档重新计算 SHA-256', archive_integrity)

    def adapter_manifest():
        package = json.loads((Path(config['adapter']) / 'package.json').read_text(encoding='utf-8'))
        require(package['name'] == 'taptap-minigame-tools' and package['version'] == '1.2.2', 'Unexpected adapter package')
        require(package['editor'] == '>=3.8.0', 'Unexpected adapter editor range')
        for required in ('dist/main.js', 'dist/builder.js', 'tap-minigame.d.ts'):
            require((Path(config['adapter']) / required).is_file(), 'Missing adapter file ' + required)
        return {'name': package['name'], 'version': package['version'], 'editor': package['editor'], 'editor_activation': 'NOT_RUN'}
    record('官方适配包清单与编译文件', adapter_manifest)

    def bundled_dependencies():
        code = "const path=require('node:path'); const root=process.argv[1]; const entries=[['archiver',root],['fs-extra',root],['@babel/core',path.join(root,'converter')],['@babel/preset-env',path.join(root,'converter')],['esprima',path.join(root,'converter')],['terser',path.join(root,'converter')]]; console.log(JSON.stringify(entries.map(([name,base])=>({name,path:require.resolve(name,{paths:[base]})}))))"
        result = subprocess.run([config['node'], '-e', code, config['adapter']], capture_output=True, encoding='utf-8', timeout=20)
        (run_dir / 'adapter-dependency-resolve.log').write_text(result.stdout + result.stderr, encoding='utf-8')
        require(result.returncode == 0, 'Bundled dependency resolution failed: ' + result.stderr)
        entries = json.loads(result.stdout)
        require(len(entries) == 6, 'Unexpected dependency result')
        return {'resolved_dependencies': len(entries), 'scope': 'Resolution only, not execution of converter or Creator extension'}
    record('插件随包依赖解析（未执行转换器）', bundled_dependencies)

    def official_five():
        files = ('sources-platform.json', 'sources-ad-guides.json')
        evidence = {}
        for filename in files:
            for source in json.loads((LOG_ROOT / filename).read_text(encoding='utf-8'))['sources']:
                evidence[source['id']] = source
        for key in ('guide', 'engine', 'iaa', 'ad-policy', 'mcp-ads'):
            entry = evidence[key]
            require(entry['status'] == 200 and entry['body_extracted'] and entry['body_characters'] > 0, 'Missing body/HTTP evidence for ' + key)
            require(len(entry['sha256']) == 64, 'Missing hash for ' + key)
        return {'required_pages_with_actual_http_and_body_evidence': 5, 'scope': 'Documentation inspection evidence, not SDK runtime validation'}
    record('指定五份官方文档检查证据', official_five)

    def initial_scope():
        initial = json.loads((LOG_ROOT / 'initial-workspace.json').read_text(encoding='utf-8'))
        require(initial['entriesBeforePreparation'] == [], 'Initial workspace was not empty')
        require(not (ROOT / 'game').exists(), 'Gameplay project was unexpectedly created')
        require(initial.get('gitInitialized') is False, 'Missing evidence that initial workspace had no Git')
        # Initial-state evidence remains immutable; user-authorized later Git setup is allowed.
        return {'initial_workspace_empty': True, 'initial_git_initialized': False, 'game_project_created': False, 'git_initialized_now': (ROOT / '.git').exists(), 'scope': 'Historical empty-workspace evidence and current phase-1 boundary; not a prohibition on later repository setup'}
    record('阶段边界与未覆盖既有项目证据', initial_scope)

    def documents():
        required = ['README.md'] + ['docs/phase-1/' + name for name in ('01-environment.md', '02-platform-verification.md', '03-mvp-design.md', '04-architecture.md', '05-roadmap-and-tests.md', '06-ad-design.md', '07-setup-and-release-gates.md', '09-git-and-windows-tooling.md')]
        for name in required:
            text = (ROOT / name).read_text(encoding='utf-8')
            require(text.startswith('# ') and len(text) > 200, 'Incomplete document: ' + name)
            require('2026-10-14' in text, 'Missing explicit date: ' + name)
        for name in ('03-mvp-design.md', '04-architecture.md', '05-roadmap-and-tests.md', '06-ad-design.md'):
            text = (ROOT / 'docs/phase-1' / name).read_text(encoding='utf-8')
            require('NOT_RUN' in text or '未进行' in text or '未实现' in text, 'Missing implementation/test status: ' + name)
        return {'substantive_documents_checked': len(required)}
    record('阶段 1 文档完整性与未测试标记', documents)

    def links():
        report = (ROOT / 'docs/phase-1/08-preparation-check-results.md').resolve()
        count = 0
        for document in [ROOT / 'README.md'] + sorted((ROOT / 'docs/phase-1').glob('*.md')):
            text = document.read_text(encoding='utf-8')
            for target in re.findall(r'\]\(<([^>]+)>\)', text):
                if re.match(r'^[A-Za-z]:/', target):
                    file = Path(urllib.parse.unquote(target.split('#', 1)[0])).resolve()
                    if file == report:
                        continue  # This generated report is written after the checks.
                    require(file.exists(), 'Broken local link: ' + str(file))
                    count += 1
        return {'existing_local_links_checked': count, 'generated_report_link_deferred': True}
    record('准备文档本地链接检查', links)

    observations = json.loads((LOG_ROOT / 'setup-observations.json').read_text(encoding='utf-8'))
    followup_path = LOG_ROOT / 'user-setup-followup.json'
    followup = json.loads(followup_path.read_text(encoding='utf-8')) if followup_path.exists() else {}
    dashboard_status = followup.get('dashboard', {}).get('status', 'BLOCKED_HTTP_403')
    pending = [
        {'item': 'Cocos Dashboard 登录界面核实', 'status': dashboard_evidence.get('loginStatus', dashboard_status)},
        {'item': '首次空工程的桌面自动操作', 'status': dashboard_evidence.get('desktopAutomationStatus', 'NOT_VERIFIED')},
        {'item': 'Creator 工作台、真实工程导入/预览/构建', 'status': 'NOT_VERIFIED'},
        {'item': 'TapTap 插件在正式工程启用与转换', 'status': 'NOT_RUN'},
        {'item': '背包/战斗/存档/奖励业务单元测试', 'status': 'NOT_IMPLEMENTED_OR_RUN'},
        {'item': '真实登录/真实广告/Android与iOS真机', 'status': 'NOT_RUN'},
        {'item': '首包/屏幕适配/前后台恢复/桌面能力', 'status': 'NOT_RUN'},
        {'item': '可测试游戏包、上架材料与发布', 'status': 'NOT_CREATED_OR_RUN'},
    ]
    passed = sum(check['status'] == 'PASS' for check in CHECKS)
    failed = sum(check['status'] == 'FAIL' for check in CHECKS)
    report = {'started_at': started.isoformat(), 'finished_at': dt.datetime.now().astimezone().isoformat(), 'scope': 'Phase-1 preparation ONLY; all game/platform integration tests remain unexecuted', 'checks_passed': passed, 'checks_failed': failed, 'checks': CHECKS, 'open_gates': pending, 'observations': observations, 'followup': followup, 'dashboard_installation': dashboard_evidence, 'overall': 'PREPARATION_CHECKS_PASSED_WITH_OPEN_GATES' if not failed else 'PREPARATION_CHECKS_FAILED'}
    (run_dir / 'results.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    lines = ['# 阶段 1：实际准备检查结果', '', '<!-- Generated by tools/validate_phase1.py -->', '', '执行时间：' + report['finished_at'], '', '**范围：只检查准备工具、安装文件和阶段 1 文档；不属于游戏功能或真实 SDK 测试。**', '', '结果：准备检查 **' + str(passed) + ' 项通过 / ' + str(failed) + ' 项失败**。其中准备工具单测的实际数量见下表；不能把它算作背包、战斗或广告奖励测试。', '', '| 检查 | 实际结果 | 详情 |', '|---|---|---|']
    for check in CHECKS:
        detail = json.dumps(check['detail'], ensure_ascii=False) if not isinstance(check['detail'], str) else check['detail']
        lines.append('| ' + check['check'] + ' | ' + check['status'] + ' | ' + detail.replace('|', '\\|') + ' |')
    lines += ['', '## 未验证或受阻项目', '', '| 项目 | 实际状态 |', '|---|---|']
    lines += ['| ' + item['item'] + ' | ' + item['status'] + ' |' for item in pending]
    history = []
    for previous in sorted(LOG_ROOT.glob('validation-*/results.json')):
        if previous.parent == run_dir:
            continue
        old = json.loads(previous.read_text(encoding='utf-8'))
        history.append((previous, old))
    if history:
        lines += ['', '## 前次执行记录（保留，不擦除失败）', '']
        for previous, old in history:
            failed_items = '、'.join(item['check'] for item in old['checks'] if item['status'] == 'FAIL') or '无失败'
            lines.append('- [' + previous.parent.name + '](<' + previous.as_posix() + '>)：' + str(old['checks_passed']) + ' 项通过 / ' + str(old['checks_failed']) + ' 项失败；' + failed_items + '。')
        lines += ['', '首次缺失的插件依赖已在独立副本按原锁文件补齐；参见 adapter-dependency-setup.json。准备工具单元测试与依赖安装均不属于玩法或真机测试。']
    lines += ['', '## 日志与复现', '', '本次完整日志：[' + run_dir.name + '](<' + run_dir.as_posix() + '>)。', '', '准备验证入口：[' + 'validate_phase1.py' + '](<' + (ROOT / 'tools/validate_phase1.py').as_posix() + '>)。', '', '运行命令：', '', '    python tools/validate_phase1.py', '', '每次运行产生新的日志目录。该命令不会安装工具、连接手机、调用广告或运行游戏。Creator 数字签名/PE 版本项校验的是本次已执行并保存的 Windows 检查证据，其观测时间保存在详情中。', '', 'Dashboard 历史自动下载出现 HTTP 403；现已独立核实安装文件、版本、签名及进程，观测时间见检查详情。登录依据用户确认，不属于独立 GUI 验证。桌面自动操作组件缺失，空工程需用户首次创建。Creator --version 探测未在 20 秒内退出，不能标记为工作台验证通过。所有阶段 2–6 的测试矩阵仍为 NOT_RUN。', '']
    destination = ROOT / 'docs/phase-1/08-preparation-check-results.md'
    if destination.exists():
        require('<!-- Generated by tools/validate_phase1.py -->' in destination.read_text(encoding='utf-8'), 'Refusing to overwrite a non-generated report')
    destination.write_text('\n'.join(lines), encoding='utf-8')
    print(json.dumps({'checks_passed': passed, 'checks_failed': failed, 'report': str(destination), 'logs': str(run_dir), 'overall': report['overall']}, ensure_ascii=False, indent=2))
    return 1 if failed else 0

if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    raise SystemExit(main())
