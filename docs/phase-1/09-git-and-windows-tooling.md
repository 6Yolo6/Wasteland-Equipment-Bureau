# 阶段 1 补充：Git 关联与 Visual Studio 安装选择

核查日期：2026-10-14（Asia/Shanghai）。本次仍是环境准备，没有开始游戏玩法开发。

## 1. 当前项目不用安装 Visual Studio 2022

若 Dashboard 安装页明确提供可选的 Visual Studio 2022 开发工具安装项，当前项目可以跳过。没有直接观察用户的安装界面；若无法跳过，需核对完整提示，不能把 C++ 编译工具和运行库视为同一组件。

本结论来自两份官方文档的适用范围对照，而不是已成功打包的结论：

- Cocos《安装配置原生开发环境》把 Visual Studio 2019/2022 放在 Windows 发布环境中，用于构建 Windows 平台原生游戏。
- TapTap《Cocos/Laya/Egret 引擎适配》说明小游戏运行于不同于浏览器的 JavaScript 环境。Cocos 先构建微信小游戏作为中间输出，再由插件转换为 Tap 小游戏。
- 当前目标产物是 game.zip，不是 Windows 桌面可执行程序，也不是 Android APK。因此不需要为这条转换路线安装 Windows C++ 编译器；“TapTap 原生小游戏”不等于“Cocos Windows 原生构建”。

计划构建顺序：Creator 3.8.8 → 微信小游戏中间产物 → 启用“转换为 Tap 小游戏” → build/TapBuild/game.zip。该流程尚未在本机执行验证。

脚本编辑继续使用已有 VS Code。Cocos 官方支持将它配置为脚本编辑器；这不是把 VS Code 当作 MSVC/C++ 编译器的替代品。现在没有必要另外安装 Build Tools 或 MinGW。未来若明确增加 Windows 桌面原生版本，再按对应 Cocos 官方要求安装 C++ 工具链；不未经验证承诺某种轻量替代一定兼容。

程序本体继续放在 D 盘；已安装 Creator 主程序为 D:/taptap/toolchains/cocos-creator-3.8.8/CocosCreator.exe。无需仅因安装提示就重复下载其他引擎版本。

## 2. Dashboard 状态（2026-10-14 后续更新）

- 用户现已确认安装完成并登录。
- 实际核实：D:/taptap/toolchains/CocosDashboard/CocosDashboard.exe；PE 版本 2.2.2；Authenticode 有效，发布者为 Xiamen Yaji Software；已观察到 Dashboard 运行进程。
- 登录状态依据用户确认；没有读取密码、令牌或账号配置，未独立观察登录界面。
- 历史自动下载的 HTTP 403、用户最初只确认下载的旧记录保留，不覆盖原日志。
- 桌面操作组件 @oai/sky 不可导入，且配置的依赖目录未提供该模块；没有绕过限制调用其他 UI 自动化方式。需要用户首次创建空白 2D 工程，然后继续检查实际文件与构建日志。
- 具体操作与隔离路径见 [首次工程检查步骤](<D:/taptap/Wasteland Equipment Bureau/docs/phase-1/07-setup-and-release-gates.md>)；安装证据见 [dashboard-installed.json](<D:/taptap/Wasteland Equipment Bureau/logs/phase-1/2026-10-14/dashboard-installed.json>)。

## 3. Git 实际动作

- 用户指定远程：6Yolo6/Wasteland-Equipment-Bureau（GitHub）。
- 检查时远程 ls-remote 成功但无可见 refs；未发现可供拉取的现有分支。
- 在现有准备目录中初始化本地 main 分支，再添加 origin；没有 clone 覆盖工作目录。
- 已执行 status、remote、ls-remote、暂存差异与 check-ignore 只读检查，均退出 0。
- 当前无提交、暂存差异为空，未执行 push。初始化 Git 不代表已取得未来推送权限。
- 本机配置、日志和 .env 被现有 .gitignore 排除；没有上传程序安装包或任何文件。

初检“没有 Git”的记录保留为历史事实。准备验证器不再把合法的后续 Git 初始化判为越过阶段边界；“尚未创建游戏工程”的阶段限制继续保留。

检查证据：[用户后续与 Git 记录](<D:/taptap/Wasteland Equipment Bureau/logs/phase-1/2026-10-14/user-setup-followup.json>)。

## 4. 官方来源与核查边界

1. Cocos《安装配置原生开发环境》：https://docs.cocos.com/creator/3.8/manual/zh/editor/publish/setup-native-development.html
2. TapTap《Cocos/Laya/Egret 引擎适配》：https://developer.taptap.cn/minigameapidoc/dev/engine/Cocos-Laya-Egret/
3. Cocos《配置代码编辑环境》：https://docs.cocos.com/creator/3.8/manual/zh/scripting/coding-setup.html

三页均已实际获取 HTTP 200 并提取正文；证据只保存元数据、哈希和来源链接，不冒充运行测试。来源记录：[构建目标](<D:/taptap/Wasteland Equipment Bureau/logs/phase-1/2026-10-14/sources-windows-tooling.json>)、[脚本编辑器](<D:/taptap/Wasteland Equipment Bureau/logs/phase-1/2026-10-14/sources-code-editor.json>)。

补充核对了官方 Dashboard 本地版本/新建工程操作及 Creator 命令行文档：[Dashboard 来源证据](<D:/taptap/Wasteland Equipment Bureau/logs/phase-1/2026-10-14/sources-dashboard-installed.json>)、[CLI 来源证据](<D:/taptap/Wasteland Equipment Bureau/logs/phase-1/2026-10-14/sources-creator-cli.json>)。官方 CLI 文档说明已有工程构建及成功退出码 36；未从该文档核实新建工程参数，因此没有编造创建命令。

本次没有安装 Visual Studio，没有运行 Creator 编辑器图形界面、TapTap 构建、广告或真机测试；Cocos 登录由用户手动完成。准备检查的实际重跑结果见 [08 实际准备检查](<D:/taptap/Wasteland Equipment Bureau/docs/phase-1/08-preparation-check-results.md>)。
