# 阶段 1：TapTap 原生小游戏官方要求核查

核查日期：**2026-10-14（Asia/Shanghai）**。标记说明：**文档核实**是官方资料确认，**本机核实**是实际检查安装文件，**待验证**不算通过。本项目不是 H5 小游戏、普通 APK 或微信小程序。

## 1. 指定的五份资料：全部已阅读

| 编号 | 资料 | 本次结论 | 官方地址 |
|---|---|---|---|
| S01 | 小游戏文档指引 | 原生小游戏开发、测试、发布的总入口；另列“添加到桌面”为必接能力 | `https://developer.taptap.cn/minigameapidoc/quick-start/document-guide/` |
| S02 | Cocos/Laya/Egret 引擎适配 | Cocos 插件支持 3.8.x 及以上；当前页面列 1.2.2；微信小游戏构建是**转换中间产物** | `https://developer.taptap.cn/minigameapidoc/dev/engine/Cocos-Laya-Egret/` |
| S03 | IAA 广告变现 | 原生小游戏通过 Dirichlet／TapADN 创建媒体、推广位并接入小游戏广告 API | `https://developer.taptap.cn/minigameapidoc/quick-start/monetization/IAA-game/` |
| S04 | 小游戏广告审核规范 | 主动选择、提前说明规则奖励、首次体验等约束均需落实 | `https://developer.taptap.cn/minigameapidoc/tap-operation/operation-standards/minigame-ad-policy/` |
| S05 | MCP 广告指南 | 适用于星火、H5、TapTap 制造；明确将 Tap 小游戏和 APK 指向 Dirichlet。本项目不套用该页接入/提现流程 | `https://developer.taptap.cn/minigameapidoc/quick-start/mcp-guide/ad-integration-guide/` |

五页 HTTP 均为 200，已读取正文。网页工具部分页面只能返回标题，因此补充从同一官方地址读取服务端 HTML，未执行远程脚本。证据记录访问时间、地址、HTTP 状态、正文是否可提取及 SHA-256，不将整页内容复制为项目文档。

TapTap 这些页的服务器 Last-Modified 本次为 2026-10-09；**不把服务器文件时间认作规范发布日期、生效日期或“最后一次产品更新”**。

## 2. 引擎与平台边界

### 已核实的链路

1. Cocos Creator：本项目选择 **3.8.8**。Cocos 官网下载页当前 3.8 系列首项为此版本，显示发布日期 2025-12-16；该版本符合 TapTap 文档要求。本次已装主程序，未声明整个编辑器工作流已通过。
2. TapTap 官方插件：页面列 **1.2.2**。实际下载包的 package.json 也为 1.2.2，包名 **taptap-minigame-tools**，编辑器范围 **>=3.8.0**。
3. 导入路径：Cocos 扩展管理器 → 导入本地扩展 → 启用插件。正式工程尚未创建，因此本次仅在 D 盘暂存，未假称已启用。
4. 构建路径：Cocos 的“微信小游戏”平台构建 → 勾选“转换为 Tap 小游戏”并填写真实 Tap 小游戏 AppID → 插件转换。
5. 官方最终输出：项目内 build/TapBuild/game.zip。**它才是原生小游戏上传文件，不提交中间的微信目录、任意 H5 ZIP 或 APK。**

TapTap 小游戏运行在其提供的 JavaScript 环境，没有浏览器 BOM/DOM。游戏纯核心不依赖浏览器对象，适配差异由引擎/平台层处理。浏览器预览只用于开发体验，不能作为 TapTap SDK 和原生运行验收。

### 插件包内核对

官方归档包含编译输出与部分运行依赖，但实际依赖解析发现 esprima 缺失，不能仅凭 README 的“已集成”就认定环境齐全。已保持原包不变，在独立配置副本依据供应方 package-lock.json 执行 npm ci（禁用生命周期脚本），锁文件哈希未变；实际解析结果见准备检查报告。包内 README 标明供应方曾测试 3.8.1/3.8.8；这是**供应方描述，不是本项目测试通过**。该 README 文末残留版本 1.2.0，而真实清单和下载页均为 1.2.2，版本记录以后二者为准。没有执行包内 AI Skills 或按其中提示自动修改项目。

供应方提供的 tap-minigame.d.ts 可用于类型对照，不能证明某设备实际支持全部 API，更不能替代真机回调测试。

## 3. 广告 SDK / 接口：哪些已核实

Dirichlet 官方小游戏专页要求在媒体管理平台把应用类型设为“小游戏”，并将技术文档指向 TapTap 小游戏 API；不是要求把 Android APP 的 AAR 或 iOS Framework 塞进 Cocos JS 小游戏。

| 能力 | 核实到的官方名称/语义 | 不可作出的假设 |
|---|---|---|
| 创建 | tap.createRewardedVideoAd，必填 adUnitId | 不臆造广告单元；不假设存在某个 Dirichlet JS 类或 npm 包 |
| 加载 | load()、onLoad、onError | load resolve 与 onLoad 的完整顺序/次数没有保证 |
| 展示 | show() 返回展示操作的 Promise | resolve 不等于视频真实开始、更不等于完播 |
| 播放开始 | 已查对象文档没有独立 onStart/onPlay | 不捏造 SDK 的开始回调；项目的 DISPLAYED 事件只表达展示确认 |
| 完播 | onClose 的 isEnded 表示是否完整观看 | 仅可信且明确 isEnded === true 可进入发奖；缺失参数不发奖 |
| 错误 | onError 的 errCode/errMsg；load/show 的 rejection | 同一错误可能由多通道报告，不能重复结算 |
| 释放 | offLoad/offClose/offError 和 destroy() | 不假设销毁后绝不再回调、销毁会产生关闭回调或可关闭正在播放的广告 |

**尚未核实**：独立“Dirichlet 小游戏 JS SDK”的当前版本号/安装包/导入方式、广告能力完整的运行时版本矩阵、回调唯一性与全顺序保证。官方文档当前给出的 JS 调用链已明确，不能为了填空转而引用 APK SDK 版本。正式接入时应记录 TapTap App/容器版本、官方插件版本、实际类型声明与广告能力测试结果；若平台另要求独立依赖，再按对应官方资料补齐。

文档还存在“整个生命周期单例”与创建参数 multiton 同时出现的表述差异。第一版串行使用广告，隔离与重建行为必须真机确认；内部 attemptId 不是 SDK 回传 ID，不能靠它猜测迟到事件属于哪次展示。详细状态机和测试见 [广告设计](<D:/taptap/Wasteland Equipment Bureau/docs/phase-1/06-ad-design.md>)。

### 审核规则与项目策略分开

- S04：首次启动后的 **60 秒内或 1 个关卡内**不展示任何广告。
- S04：首次启动后的 **120 秒内或 3 个关卡内**，强制中断流程的全屏广告不得超过 1 条。本 MVP 不做此类强制广告。
- S04：玩家主动选择激励视频，展示前说明观看条件和奖励；不能遮挡/混淆广告交互区域。
- **项目自定保守策略**：首局完全禁广告，同时累计有效前台体验至少 60 秒；以后候选间隔 90 秒、每日最多 8 次。后两数字不是平台硬限制，可经体验测试下调频率，不能用 MCP 插屏频率冒充激励视频规则。
- “一波是否算一关”、首次启动跨重装识别、计时口径未在公开规范细化，需官方确认；本项目不通过关闭游戏再开或改设备时间绕过限制。

## 4. 登录：无服务端 MVP 的重要范围边界

已核实：tap.login 使用 success/fail/complete 回调，文档标明不支持直接 Promise 风格；应用适配器可以自行包装 Promise，但不能误写成官方异步签名。返回的 code 是一次性临时凭证，**不是已认证用户 ID**。tap.checkSession 用于检查平台登录态。

官方完整登录流程为：客户端获取 code → 开发者服务器调用 auth.code2Session → 获得 openid/unionid/session_key → 返回自定义业务登录态。服务端凭据和 session_key 不能放进客户端，也不能把 session_key 当作业务令牌下发。

创建小游戏的包体指引要求正确接入 TapTap 登录，但公开资料没有直接回答“纯本地、无开发者服务器的本 MVP，是否必须完成 code2Session 才满足审核”。因此：

- 阶段 2–4 按本地档案/本地单机运行，不新增账号服务器或云数据库，不虚构登录成功。
- 阶段 5 前向官方核实无服务端原生小游戏的登录验收口径，保留工单答案。
- 若官方明确要求完整兑换：这是用户范围与平台要求的真实冲突。再讨论一个最小、安全的兑换端点（可以不配数据库），**未经用户同意不开发/部署它**。
- 仅调用 tap.login 获得 code 不能把“正式平台登录已完成”勾成通过。

## 5. 包体格式已清楚，大小要求存在真实冲突

| 官方来源 | 本次读到的要求 | 状态 |
|---|---|---|
| 创建小游戏/包体上传（S06） | TapTap 工具打包的指定 ZIP；首包描述为“不超过60M+” | 原文措辞含混 |
| 启动优化（S07） | 普通小游戏首包不超过 4M，含所有分包总量不超过 60M | 与上行口径不同 |
| Cocos 适配（S02） | 产物 game.zip | 一致、可据此实施 |

不擅自选一个数字称作“已统一核实”。**项目暂按主包 ≤4 MB、完整 MVP 目标 ≤15 MB做资源预算**，并把压缩/解压、主包/分包、引擎/字体计入方式及 MB 字节口径列为上线前确认项。预算不是当前实测包大小，也不是通过平台审核的承诺。

首版只用 2D 必需引擎模块、少量原创图形/图集、经授权且按许可处理的字体和短音效；不要为了首包凭空启用 WASM 分包、远程 CDN 或引入 Spine 等额外系统。

## 6. 官方测试路径与设备门槛

S08 真机调试文档区分两条路径：

| 路径 | 官方文档标出的最低 App 版本 | 前提 |
|---|---|---|
| VS Code 的 TapTap MiniGame Debugger → 本地扫码 | Android 2.83.2；iOS 4.58.0 | 打开转换后的代码包根目录；手机/电脑同局域网；真实小游戏 ID；测试账号权限 |
| 开发者后台上传开发版本 ZIP → 扫测试包二维码 | Android 2.83.0；iOS 4.55.0 | 正确创建小游戏、上传开发版、账号在测试名单 |

这些是**该测试路径的文档门槛，不是已经验证了广告的最低版本**。实际测试优先使用当时官方可获得的受支持客户端，并记录具体版本。最低版本回归需要另做。

Android 可用已安装 ADB 与 Chrome DevTools，文档给出端口 9229 的转发步骤。当前没有启动 ADB 服务、连接手机、安装调试扩展、扫码或上传游戏。iOS 的 Safari 深度调试/设备日志官方流程需要 macOS，本机 Windows 不能声称完成此验证。可以先以 Android 做 MVP 工具验证，但没有擅自把产品缩减为 Android-only。

## 7. 新发现的必接能力及发布前提

- **添加到桌面**：S01 将其列为必接。S09 给出 tap.hasHomeScreenWidgetAndPinned 与 tap.createHomeScreenWidget。用户主动添加；取消/失败不影响普通游戏；本 MVP 不用它发金币奖励。
- S09 明确后台扫码自测暂不能测试此功能，需已审核上线的版本；因此把“线上最小灰度后的补验”单列，不能声称开发包中已全链路通过。iOS 的 isPinned 不支持，而且需要用户在 Safari 手动完成添加；不能把 success 一律当作添加成功。
- **离线**：本地无服务器设计不等于 TapTap 容器自动具备离线冷启动能力；如要求平台离线启动，应另外申请/核实离线能力，不纳入第一版硬承诺。
- **账号/主体与发布**：后台创建小游戏、真实 AppID、测试账号、Dirichlet 媒体/推广位及审核、小游戏前置备案、隐私和素材授权均未办理。不会代填身份、签约、上传资质或提交发布。
- 官方指南将普通小游戏前置备案列为正式上架前提；具体主体和材料以对应后台当期要求为准。不用“无内购”推断免除其他发布义务。

## 8. 补充官方来源与可复核证据

| 编号 | 来源 | 官方地址 |
|---|---|---|
| S06 | 创建小游戏/包体要求 | `https://developer.taptap.cn/minigameapidoc/quick-start/guide/creation-improvement/` |
| S07 | 启动速度/包体限制 | `https://developer.taptap.cn/minigameapidoc/dev/tutorial/performance/launch/launch-speed/` |
| S08 | 真机调试 | `https://developer.taptap.cn/minigameapidoc/dev/dev-support/debugging/` |
| S09 | 桌面文件夹 | `https://developer.taptap.cn/minigameapidoc/dev/tutorial/open-capabilities/desktop-folder/` |
| S10 | 登录态管理 | `https://developer.taptap.cn/minigameapidoc/dev/tutorial/open-capabilities/login-management/` |
| S11 | tap.login | `https://developer.taptap.cn/minigameapidoc/dev/api/open-api/login/tap.login/` |
| S12 | code2Session | `https://developer.taptap.cn/minigameapidoc/dev/server/login/code2Session/` |
| S13 | Dirichlet 小游戏入口 | `https://ssp.dirichlet.cn/docs/mini-program-guide/` |
| S14 | 激励视频教程 | `https://developer.taptap.cn/minigameapidoc/dev/tutorial/open-capabilities/ad/rewarded-video-ad/` |
| S15 | 创建激励视频/回调对象 | `https://developer.taptap.cn/minigameapidoc/dev/api/ad/RewardedVideoAd/` |
| S16 | Cocos 官网下载 | `https://www.cocos.com/creator-download` |
| S17 | Cocos 安装与启动 | `https://docs.cocos.com/creator/3.8/manual/zh/getting-started/install/` |
| S18 | 小游戏前置备案 | `https://developer.taptap.cn/minigameapidoc/quick-start/guide/pre-filing/` |

精确方法页（create/load/show/onClose/onError/destroy）、配置页等完整地址、响应时间和哈希均保存在 [证据目录](<D:/taptap/Wasteland Equipment Bureau/logs/phase-1/2026-10-14>)。首次对 Cocos/Dirichlet 文档正文的解析失败已保留；随后修正解析器并在 sources-support.json 记录成功，不把早先空正文标记擦掉。

## 9. 上线前必须关闭的问题

1. 官方有效 Dashboard 安装来源或经实际验证的工程创建方式；Cocos 工程能打开/预览/导出。
2. 正式 AppID、Dirichlet 真实推广位和测试权限。当前没有任何 ID，不放看似有效的示例 ID。
3. 无服务器登录要求及安全的验收路径。
4. 主包/总包大小的冲突和后台实际校验口径。
5. 激励视频在目标 App 版本上的回调归属、终态隔离、销毁和恢复行为。
6. 桌面能力开发版不可测的限制、线上验证安排及 iOS 差异。
7. 备案/主体/隐私/素材授权与测试材料；若要 iOS 深度调试，补齐对应设备环境。

以上不会阻止编写纯逻辑和 Mock 测试，但会阻止把 MVP 宣称为“已通过 TapTap 原生上线验证”。
