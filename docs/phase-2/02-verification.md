# 阶段 2：实际验证记录

日期：2026-10-15，时区 Asia/Shanghai。

> **历史基线**：本页记录人工试玩整改前的 mvp-0.2.0 / 152 项测试候选版。最新 mvp-0.2.1、174 项测试及扩展浏览器回归见 [人工试玩整改记录](<D:/taptap/Wasteland Equipment Bureau/docs/phase-2/05-playtest-feedback.md>)。下方原始日志和未测状态按当次执行保留，不用作当前进度面板。

**结论：阶段 2 核心闭环已实现并通过本轮自动验证，可本机试玩。仅验证 Cocos Web Mobile 开发构建，不是 TapTap 原生包验收，也不是完整 MVP / 阶段 3–6 完成声明。**

## 本轮实测结果

| 层级 | 实际结果 | 证据与边界 |
|---|---|---|
| 核心与控制器 | 严格 TypeScript 编译、AST 依赖边界通过；152/152 测试通过 | [本轮完整日志](<D:/taptap/Wasteland Equipment Bureau/logs/phase-2/core-tests-2026-10-15T03-18-01-640Z.log>)；[测试摘要](<D:/taptap/Wasteland Equipment Bureau/logs/phase-2/core-tests-latest.json>)。纯逻辑/命令控制器测试，不替代引擎执行。 |
| Cocos 声明检查 | 通过；TypeScript 4.9.5 | [声明检查日志](<D:/taptap/Wasteland Equipment Bureau/logs/phase-2/cocos-typecheck-latest.log>)。使用本机 Creator 3.8.8 的实际声明，不是运行时验证。 |
| Creator 实际构建 | 两次 CLI 构建通过，两个进程均返回 Creator 成功码 36 | [本轮构建结果](<D:/taptap/Wasteland Equipment Bureau/logs/phase-2/creator-game-20261015-111553-960606/result.json>)；[导入日志](<D:/taptap/Wasteland Equipment Bureau/logs/phase-2/creator-game-20261015-111553-960606/import-build.stdout.log>)；[最终构建日志](<D:/taptap/Wasteland Equipment Bureau/logs/phase-2/creator-game-20261015-111553-960606/game-build.stdout.log>)。 |
| 真浏览器游戏回归 | BROWSER_GAME_PASSED，6 组检查全部通过 | [本轮浏览器结果](<D:/taptap/Wasteland Equipment Bureau/logs/phase-2/browser-game-2026-10-15T03-18-01-498Z/result.json>)。本机 Chrome 154.0.8037.99，实际运行 Cocos 构建产物。 |
| 准备工具回归 | Python 单测 12/12 通过 | [准备工具日志](<D:/taptap/Wasteland Equipment Bureau/logs/phase-2/preparation-unit-tests-latest.log>)。不计入 152 项游戏测试。 |
| 异步等待工具 | Node 单测 5/5 通过 | [轮询工具日志](<D:/taptap/Wasteland Equipment Bureau/logs/phase-2/async-poll-tests-latest.log>)。不计入游戏测试；首次子进程启动被沙箱 EPERM 阻止，获准在沙箱外重跑后通过。 |
| 本机试玩服务 | HTTP 200，返回内容逐字节匹配已构建的 index.html | [HTTP 检查](<D:/taptap/Wasteland Equipment Bureau/logs/phase-2/preview-http-check.json>)；仅回环地址，不对局域网开放。 |

- 核心测试完成：2026-10-15 11:18:02 +08:00。
- 最终构建完成：2026-10-15 11:16:27 +08:00。
- 浏览器执行：2026-10-15 11:18:01 +08:00 至 2026-10-15 11:18:49 +08:00。
- 构建产物：26 个文件，共 6,914,989 字节。**这是 Web debug 目录的文件总和，不是 TapTap 首包大小，不据此声称通过原生包体门禁。**
- 构建前后源码稳定性记录为 true；[源码 SHA-256 清单](<D:/taptap/Wasteland Equipment Bureau/logs/phase-2/creator-game-20261015-111553-960606/source-manifest.json>)与[构建文件清单](<D:/taptap/Wasteland Equipment Bureau/logs/phase-2/creator-game-20261015-111553-960606/build-manifest.json>)保留在本轮目录。浏览器报告指向这次构建；报告中的 Creator browser: NOT_RUN 表示构建脚本自身不运行浏览器，应结合单独浏览器报告阅读。

## 覆盖范围

### 152 项核心与交互测试

覆盖内容配置、种子随机数及拒绝采样、背包边界/形状/旋转/原子交换/撤销/备存、四种组合推导与属性上限、固定 tick 战斗顺序/伤害/护盾/治疗/消耗品/首领阶段、五波状态转换、补给选择、胜利/失败/主动结束结算、命令标识与旧局隔离、重复领奖、调度器暂停，以及引擎无关界面控制器的输入与模态边界。

测试中的序列化回放和钱包幂等证明的是纯状态逻辑及同次会话行为。**没有持久化存档、断电恢复、跨进程原子性或防篡改保证。**

### 6 组实际 Cocos 浏览器检查

1. 真实 Smoke 场景中 BureauRoot 初始化，主菜单显示，默认 profiler 已关闭。
2. 鼠标通过真实画布装备物品、激活 C01、拒绝非法落点并回滚、旋转预览/确认、撤销。
3. 实际战斗推进后点击暂停；等待 400ms tick 不变；明确恢复后继续。
4. 依次整理装备、选择补给、正常运行五波，首领胜利并通过按钮领取 32 枚基础金币。
5. 在 360×800 视口再次操作鼠标和 R/Z/Escape；弹窗拦截底层点击及撤销，取消结束出勤正确解除自身暂停原因；零胜场主动放弃后钱包仍为 32。
6. 期间没有未捕获异常、console error / warning、请求失败、HTTP 错误或外部请求。

自动化规划器只在独立的纯逻辑副本上挑选合法布局，再发出鼠标/键盘输入；读取真实组件状态用于断言。**没有改写战斗生命、伤害、掉落配置、tick 或结算状态，没有以假引擎或纯模拟替代实际渲染。**

主流程视口 720×1280；另外检查 360×800、320×720 和 1280×720 的画布与截图。实际额外输入回归使用 360×800，另外两个尺寸不等于真机触摸测试。真实浏览器本轮覆盖胜利和主动放弃，失败分支的保证来自核心/控制器测试，未声称另跑过真机失败流程。

## 五波实际通关样本

开发内容版本 mvp-0.2.0-dev-all，默认种子 20261015；全部 14 件装备开放仅用于验证。标准版本仍保留初始 10 件解锁池，不代表永久成长已实现。

| 波次 | 结果 | 战斗模拟时长 | 剩余生命 |
|---|---|---|---|
| 1 | victory | 11.0 秒 | 110 |
| 2 | victory | 4.9 秒 | 110 |
| 3 | victory | 5.6 秒 | 110 |
| 4 | victory | 7.7 秒 | 110 |
| 5 | victory | 8.4 秒 | 95 |

- 五波战斗合计 37.6 秒，不包含装备思考、整理、补给或暂停。
- 结算：5×4＋12＝32 枚基础金币；领取后回菜单，钱包为 32。
- result.json 内 playthrough.settlement.claimed 为领取前截图时的快照；随后领取和钱包数值由脚本断言，最终通过记录包含该步骤。
- 本轮只证明该开发种子可正常通关，不代表所有种子平衡、真人单局 3–6 分钟、留存或广告变现目标已达成。

## 最终截图核对

以下均来自上述通过的实际 Cocos 构建，不是设计稿或 TapTap 手机截图。已查看菜单、整备、暂停、战斗、补给、首领前整备、结算和窄/横屏截图；主要按钮未被 profiler 遮挡，组合收益可见。人工可读性、触摸目标和系统字体差异仍需真实设备复核。

| 画面 | 证据 |
|---|---|
| 主菜单 | [01-menu.png](<D:/taptap/Wasteland Equipment Bureau/logs/phase-2/browser-game-2026-10-15T03-18-01-498Z/01-menu.png>) |
| 背包与组合 | [02-preparation.png](<D:/taptap/Wasteland Equipment Bureau/logs/phase-2/browser-game-2026-10-15T03-18-01-498Z/02-preparation.png>) |
| 暂停 | [03-paused.png](<D:/taptap/Wasteland Equipment Bureau/logs/phase-2/browser-game-2026-10-15T03-18-01-498Z/03-paused.png>) |
| 自动战斗 | [04-combat.png](<D:/taptap/Wasteland Equipment Bureau/logs/phase-2/browser-game-2026-10-15T03-18-01-498Z/04-combat.png>) |
| 补给选择 | [05-loot.png](<D:/taptap/Wasteland Equipment Bureau/logs/phase-2/browser-game-2026-10-15T03-18-01-498Z/05-loot.png>) |
| 首领前整备 | [06-boss-preparation.png](<D:/taptap/Wasteland Equipment Bureau/logs/phase-2/browser-game-2026-10-15T03-18-01-498Z/06-boss-preparation.png>) |
| 五波胜利 | [07-victory.png](<D:/taptap/Wasteland Equipment Bureau/logs/phase-2/browser-game-2026-10-15T03-18-01-498Z/07-victory.png>) |
| 320×720 窄屏 | [menu-320x720.png](<D:/taptap/Wasteland Equipment Bureau/logs/phase-2/browser-game-2026-10-15T03-18-01-498Z/menu-320x720.png>) |
| 360×800 竖屏 | [menu-360x800.png](<D:/taptap/Wasteland Equipment Bureau/logs/phase-2/browser-game-2026-10-15T03-18-01-498Z/menu-360x800.png>) |
| 1280×720 横屏留白 | [menu-1280x720.png](<D:/taptap/Wasteland Equipment Bureau/logs/phase-2/browser-game-2026-10-15T03-18-01-498Z/menu-1280x720.png>) |

## 本阶段发现并修复的问题

| 问题 | 修复与证据 |
|---|---|
| Cocos 转译把 Set 展开降为数组 concat，组合列表在真实构建中异常 | 改为 Array.from(new Set(...))；[保留的失败结果](<D:/taptap/Wasteland Equipment Bureau/logs/phase-2/browser-game-2026-10-15T03-12-37-070Z/result.json>)，修复后重新真实构建及完整五波回归通过。 |
| 默认性能面板遮挡底部控制 | BureauRoot 初始化关闭 profiler；真实浏览器断言与最终截图验证。 |
| 非法/画布外拖动被误判为收回备存 | 区分非法落点和备存目标，失败保留原布局；自动回归通过。 |
| Escape 关闭确认窗后残留暂停原因 | 只解除 confirm-abandon 原因；其他暂停保持；核心及浏览器回归通过。 |
| 模态窗仍允许底层点击或 Z 撤销 | 统一阻挡底层指针与快捷键命令；核心及浏览器回归通过。 |
| 自动命令编号与外部已用编号冲突 | 跳过已处理编号，拒绝空/非法标识；152 项测试包含回归。 |
| 调度器配置可接受非法时长/补帧预算 | 对有限正数时长和安全整数预算做边界校验；回归通过。 |
| 异步浏览器就绪谓词可能过早视为成功 | 显式 await 的 pollUntil，超时有界且不吞异常；独立 5 项工具测试通过。 |

旧失败记录不删除，不以较早通过替代最后候选版的真实回归。

## 阶段 1 旧校验器的已知范围冲突

2026-10-15 11:04 的 [阶段 1 校验器保留记录](<D:/taptap/Wasteland Equipment Bureau/logs/phase-1/2026-10-14/validation-110439/results.json>)实际是 **15 项通过 / 1 项失败**。失败原文：Gameplay project was unexpectedly created。

该脚本专为“尚未创建玩法工程”的阶段 1 编写，硬性要求 game 目录不存在。现在已进入阶段 2，该前提不再适用；这里保留失败，不删除游戏来让旧检查变绿，也不把该运行改成通过。它不是阶段 2 的回归入口。

该次目录名含 2026-10-14 是旧脚本硬编码，实际运行时间是 2026-10-15。脚本还硬编码了 2026-10-14 文档日期及后续业务 NOT_RUN 占位；[原生成报告](<D:/taptap/Wasteland Equipment Bureau/docs/phase-1/08-preparation-check-results.md>)已加范围说明，原始结果保留。不要把这些占位当成当前游戏状态。阶段 2 应运行本页列出的命令；本轮没有宣称这个旧阶段校验器整体通过。

## 复现与试玩

工作目录：D:/taptap/Wasteland Equipment Bureau。

~~~powershell
python tools/run_tool.py node tools/test_game.cjs
python tools/run_tool.py node tools/check_cocos.cjs
python tools/build_game.py --timeout 600
python tools/run_tool.py node tools/verify_game.cjs
python tools/run_tool.py node tools/serve_preview.cjs
~~~

当前试玩服务地址为 http://127.0.0.1:4173，仅监听本机回环；进程/启动时间见 [预览服务记录](<D:/taptap/Wasteland Equipment Bureau/logs/phase-2/preview-server.json>)。记录不保证未来进程仍在运行，服务退出后重跑最后一条命令，Ctrl+C 可停止。

Creator 工程入口：[game](<D:/taptap/Wasteland Equipment Bureau/game>)；场景：[Smoke.scene](<D:/taptap/Wasteland Equipment Bureau/game/assets/Smoke.scene>)。原始 verification/EngineSmoke 保持不动。

## 明确未做 / 未测

- 未完成人工试玩、Creator GUI 重新打开复核、Android/iOS 真机或 TapTap 客户端验收。
- 未做真实手机的后台、锁屏、系统杀进程、低内存、离线恢复、长时温升与性能测试；浏览器暂停和纯调度器测试不能替代这些项目。
- 尚无持久存档、永久金币/装备解锁/图鉴/成就、每日挑战、系统教程、音效。刷新即丢失本次进度与金币。
- 未启用正式 TapTap 转换插件、生成原生测试包、接入真实登录或广告 SDK；未捏造任何账号/广告标识。
- 未验证广告完播与异常回调、原生包体限制、隐私/审核要求；无真实广告和收入。
- 未 commit、push、上传审核或发布；没有把 Web 构建当作 TapTap 发布交付。

下一步见 [阶段 3 工作清单](<D:/taptap/Wasteland Equipment Bureau/docs/phase-2/03-next-stage.md>)，先持久存档与故障恢复，再成长及体验，不在本轮擅自接入广告。
