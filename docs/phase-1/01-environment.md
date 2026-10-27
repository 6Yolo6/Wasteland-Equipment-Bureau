# 阶段 1：环境检查与实际安装结果

核查日期：**2026-10-14，Asia/Shanghai**。本文区分“初始状态”“本次变更”和“未验证项”，不把安装成功当成游戏测试通过。

## 1. 初始状态（先检查，后写文件）

- 工作目录：D:/taptap/Wasteland Equipment Bureau，最初为空；未发现已有工程或文件，因此没有覆盖任何既有项目。
- 上级及本目录没有发现额外 AGENTS.md 文件，遵守用户在任务中给出的 Windows 优化规则。
- Git 已安装，但初检时当前目录不是 Git 仓库；两条 Git 状态命令均返回 128。首次准备未初始化 Git；2026-10-14 用户提供远程仓库后才初始化并关联，后续状态见文末补充。
- 系统为 Windows 10 x64。初检时物理内存约 19.63 GiB、可用约 5.75 GiB；D 盘可用约 160.47 GiB。这是当时快照，不是永久性能保证。

| 工具 | 初检实际结果 | 解释 |
|---|---|---|
| Node.js / npm | 20.19.0 / 10.8.2 | 原有全局工具可执行；未替换 |
| Python | 默认 3.8.6；另有 3.10.6 | 准备脚本仅用标准库；没有安装 Python |
| Git / rg | 2.39.2.windows.1 / 15.2.0 | 可执行 |
| Cocos Creator / Dashboard | PATH、常见安装目录和卸载注册表中未发现 | 不是“穷尽整盘证明未安装”；任意目录便携版可能不在扫描范围 |
| Android Studio | 注册表发现 2025.1 | 无需为本项目重装 |
| ADB | 不在 PATH；D:/AndroidSdk/platform-tools/adb.exe 可执行，36.0.0-13206524 | 复用此工具；未启动 ADB 服务、枚举/连接手机或修改 USB 设置 |
| Java | 默认 java 指向失效的 D:/jdk8，返回错误 | JAVA_HOME 为 D:/jdk21，直接运行该目录 java 为 21.0.12；未修全局 PATH |
| CMake / Ninja | PATH 未发现 | 不是本次 Cocos JS 原生小游戏转换链路的先决条件；不因此批量安装 Android/APK 工具链 |

原始证据：
- [最初目录记录](<D:/taptap/Wasteland Equipment Bureau/logs/phase-1/2026-10-14/initial-workspace.json>)
- [只读环境快照](<D:/taptap/Wasteland Equipment Bureau/logs/phase-1/2026-10-14/environment.json>)

## 2. 用户授权后的工具安装

用户明确允许从网上下载必要工具并安装在 D 盘。本次选择 **D:/taptap/toolchains**，检查该目录原先不存在后才创建。未修改全局 PATH，没有覆盖现有 Node、Java、ADB 或其他工程。

| 工具 | 实际位置 | 已执行验证 | 仍未验证 |
|---|---|---|---|
| Cocos Creator 3.8.8 | D:/taptap/toolchains/cocos-creator-3.8.8/CocosCreator.exe | 官方 ZIP 下载并安全解压；PE 文件/产品版本均为 3.8.8；Windows Authenticode 状态 Valid，签名主体 Xiamen Yaji Software Co., Ltd. | 编辑器工作台、工程导入、场景预览、TapTap 构建 |
| Node.js 24.21.0 / npm 11.19.0 | D:/taptap/toolchains/node-24.21.0/node-v24.21.0-win-x64 | 官方 SHA-256 校验一致；两个版本命令实际成功 | 未来游戏依赖链的兼容与构建 |
| TapTap 转换插件 1.2.2 | 配置副本：D:/taptap/toolchains/taptap-adapter-1.2.2-ready/taptap-minigame-tools | 真实清单为 taptap-minigame-tools / 1.2.2 / editor >=3.8.0；首次依赖检查发现原包缺 esprima，已按自带锁文件在独立副本补齐 | **仅配置准备，尚未在正式工程导入/启用/构建** |
| Cocos Dashboard 2.2.2 | D:/taptap/toolchains/CocosDashboard/CocosDashboard.exe | PE 文件/产品版本 2.2.2；Authenticode Valid；已观察到运行进程 | 用户确认已登录；未独立观察登录 UI、Creator 接入及项目创建 |

Cocos/插件压缩包记录了 SHA-256 供复核，但没有把“自己计算哈希”说成“官网已发布同一哈希”；Cocos EXE 另做了有效数字签名验证。Node 则确实和官网校验清单比较。下载档案保留在 D:/taptap/toolchains/downloads，不自动清理。

程序本体和下载包都在 D 盘；Creator 启动时默认将少量用户配置写到 C:/Users/Administrator/.CocosCreator。这不等同于将主程序装在 C 盘，也没有声称所有应用缓存均已迁移。

原始插件目录 D:/taptap/toolchains/taptap-adapter-1.2.2/taptap-minigame-tools 保持不变。第一次准备检查发现 esprima 无法解析，因此对独立配置副本执行 npm ci，安装 141 个锁定包、禁用生命周期脚本；锁文件 SHA-256 前后一致。没有依照 npm 的升级提示全局更新版本，也没有声称已做依赖安全审计。[依赖修复证据](<D:/taptap/Wasteland Equipment Bureau/logs/phase-1/2026-10-14/adapter-dependency-setup.json>)保存了精确命令和结果。

## 3. 启动检查的准确边界

曾以隐藏窗口尝试 CocosCreator.exe 的 --version 参数。进程可启动，日志有初始化输出，但 20 秒内没有退出，没有获得可用的版本命令输出。这项探测**不能算编辑器可用性测试通过**；版本结论来自独立 PE 元数据。

只终止了本次探测创建的进程及子进程，没有打开游戏工程。没有关闭用户的其他应用。完整日志：
- [Creator 标准输出](<D:/taptap/Wasteland Equipment Bureau/logs/phase-1/2026-10-14/creator-version.stdout.log>)
- [Creator 错误输出](<D:/taptap/Wasteland Equipment Bureau/logs/phase-1/2026-10-14/creator-version.stderr.log>)
- [安装/启动异常记录](<D:/taptap/Wasteland Equipment Bureau/logs/phase-1/2026-10-14/setup-observations.json>)

本次桌面检查运行时缺少 @oai/sky，未能观察编辑器窗口；未绕过限制另建 UI 自动化工具，也未代填账号。自动下载失败保留为历史记录；用户手动安装后已核实 Dashboard 2.2.2 程序及运行进程。桌面操作组件 @oai/sky 再次导入失败；尚不能自动观察/操作 Dashboard 或验证 Creator 工程，未读取登录凭证。

## 4. 可复用工具与证据

- [下载规划与官网来源](<D:/taptap/Wasteland Equipment Bureau/logs/phase-1/2026-10-14/toolchain-plan.json>)
- [下载哈希、解压与插件清单](<D:/taptap/Wasteland Equipment Bureau/logs/phase-1/2026-10-14/toolchain-install.json>)
- [Windows 版本/签名验证](<D:/taptap/Wasteland Equipment Bureau/logs/phase-1/2026-10-14/toolchain-verification-windows.json>)
- [本机工具路径](<D:/taptap/Wasteland Equipment Bureau/toolchains.local.json>)
- [只读环境检查脚本](<D:/taptap/Wasteland Equipment Bureau/tools/inspect_environment.py>)
- [隔离 CLI 启动器](<D:/taptap/Wasteland Equipment Bureau/tools/run_tool.py>)：支持 node、npm、adb、python、info，仅修改子进程环境，不改机器 PATH。

运行例（在项目目录执行；这些不是游戏启动命令）：

    python tools/run_tool.py node --version
    python tools/run_tool.py npm --version
    python tools/run_tool.py adb version

本机配置不应提交到公共仓库，今后正式工程使用的 TypeScript 版本随 Cocos 生成配置锁定，不因为已安装 Node 24 就盲目安装最新版编译器。

## 5. 阶段判断

**检查与工具准备已完成到可记录/可复核状态；环境全链路尚未放行。**纯逻辑设计、内容配置和测试设计不依赖 Dashboard，可继续；阶段 2 的 Cocos 展示集成需要完成真实工程创建/导入验证。阶段 5 的原生、广告、登录和真机验证均未执行。没有游戏包、APK、H5 发布包或伪造截图交付。

## 后续更新（2026-10-14）

- 已按用户提供的仓库配置本地 Git：main 分支、origin 指向 6Yolo6/Wasteland-Equipment-Bureau；只初始化元数据，没有暂存、提交、推送或覆盖文件。
- 已核对 Cocos 原生开发环境与 TapTap 引擎适配官方文档：Visual Studio 2022 对应 Windows 桌面原生 C++ 构建，不是当前 TapTap JS 小游戏转换流程的必要工具，因此未安装。
- Dashboard 2.2.2 手动安装后已核实程序位置、版本、签名及进程；登录由用户确认，未读取凭证或独立验证登录界面。证据：[安装核验](<D:/taptap/Wasteland Equipment Bureau/logs/phase-1/2026-10-14/dashboard-installed.json>)。
- 已建立空的 D:/taptap/Wasteland Equipment Bureau/verification 父目录并加入 Git 忽略。尚未创建任何 Cocos 工程；计划由真实 Dashboard 在其中生成 EngineSmoke。详情见 [配置步骤](<D:/taptap/Wasteland Equipment Bureau/docs/phase-1/07-setup-and-release-gates.md>)。

### EngineSmoke 创建后的检查（2026-10-14）

用户已创建并打开真实 EngineSmoke。package.json 声明 Creator 3.8.8，工程配置启用 2D、关闭 3D；日志中包含 3.8.8 初始化记录，所检查的 10 行中无 warn/error。未自动观察 GUI，未验证保存/重新打开。assets 仍为空，所以预览和构建为 NOT_RUN_NO_SAVED_SCENE；未创建构建副本，未改动原工程。Creator 在该临时工程中生成了自己的 .git；保持不动，整个 verification 目录已由外层仓库忽略。

证据：[工程与日志检查](<D:/taptap/Wasteland Equipment Bureau/logs/phase-1/2026-10-14/creator-project-created.json>)、[启动日志快照](<D:/taptap/Wasteland Equipment Bureau/logs/phase-1/2026-10-14/creator-project-created.startup.log>)。该结果不是玩法、浏览器构建或 TapTap 实机测试。
