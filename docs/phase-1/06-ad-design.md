# 06 — 广告设计与激励奖励安全边界

- 项目：TapTap 原生小游戏《废土装备局》。
- 文档日期：2026-10-14（Asia/Shanghai）；复用广告专项核查截至当日 10:10 的官方网页证据。
- 当前状态：阶段 1 设计；真实广告适配尚未实现或验证；本文所有 Mock 自动测试与真机接入门禁均为 **NOT_RUN**。
- 范围：广告配置、接口隔离、项目频控、业务奖励、回调归属、存档事务、可控模拟与接入门禁。不承担工具安装、引擎、登录、包体或玩法实现。
- 证据获取：已通过 web.run 打开官方页面；部分 VuePress 页面解析为空，另以只读 HTTP 获取原站 SSR HTML 正文和链接佐证，未执行远程脚本。本文不把“文档有说明”写成“真机测试通过”。

## 1. 不可混淆的官方事实与未核实项

### 1.1 产品与接入路径

1. 本项目目标是 **TapTap 原生小游戏**，不是浏览器 H5、普通 Android APK、iOS 原生手游或微信小游戏。官方 IAA 与广告联盟介绍将 Tap 小游戏广告变现指向 Dirichlet／TapADN。[S01][S21]
2. Dirichlet 小游戏专页要求使用 TapTap 开发者账号登录 Dirichlet 媒体管理平台，创建媒体时将应用类型设为“小游戏”；广告位、数据报表和结算在 Dirichlet 侧管理，技术链接指向 TapTap 小游戏广告文档。[S04]
3. **MCP 广告指南不适用于本项目的原生小游戏接入。**该指南限定星火、H5 小游戏、TapTap 制造，并明确将 Tap 小游戏和 APK 指向 Dirichlet。因此，不复制其中在开发者中心直接开通／提现的流程、提现数字或将其插屏建议视为本项目独立审核依据。这是适用范围区别，而非要求接两套广告。[S03]
4. 当前小游戏示例直接使用 `tap.createRewardedVideoAd`。**尚未核实独立 Dirichlet 小游戏 JS SDK 的 npm 包名、单独 JS 下载包、import／require 方式、当前 JS 版本号或版本发布记录。**不能据此断言独立包不存在，也不能凭 SDK 名称自行编造导入代码。[S05][S06][S16]
5. Dirichlet 下载目录中的 Android AAR、iOS CocoaPods 指引、UnityPackage 属于相应原生 APP SDK 资源，不能作为小游戏 JS 依赖或小游戏支持版本的证明。目录当时列出 Android／Unity 5.3.0.4（2026-10-08）与 iOS 5.3.0.1（2026-09-24）；这些数字**不是本项目 JS SDK 版本**。[S16]
6. 已查广告专页未给出足以确认本项目的最低 TapTap／小游戏运行时版本及 Android／iOS 广告能力矩阵。此项须在真实适配前获得官方确认并按实际目标端验证，不能借用原生手游 SDK 的平台声明。[S04][S06][S07]

### 1.2 激励视频官方 API 清单

下表仅列实际查到的 **SDK／平台名称**。第 4 节才是我们自己的接口和事件，两者不得互相冒充。

| 官方对象／方法 | 已核实含义 | 没有得到的保证 | 来源 |
| --- | --- | --- | --- |
| `tap.createRewardedVideoAd(Object)` → `RewardedVideoAd` | `adUnitId` 为必填 string；另有 `multiton` boolean，默认 false | 未给出多例最低支持版本及隔离边界 | [S06] |
| `RewardedVideoAd.load()` | Promise 表示加载操作结果 | 与 `onLoad` 的严格先后关系未声明 | [S08] |
| `RewardedVideoAd.onLoad(listener)` | 加载完成事件；教程描述创建后自动拉取、关闭后清空并自动加载下一份素材 | 不是展示、用户同意、视频开始或领奖证据；不能假设每次只回调一次 | [S10][S05] |
| `RewardedVideoAd.show()` | Promise 表示显示操作结果；素材未就绪时可 reject | resolve 不是视频开始或完播；与关闭／错误事件的全序关系未声明 | [S09][S05] |
| `RewardedVideoAd.onClose(listener)` | 参数 `isEnded: boolean` 表示关闭时是否完整观看；教程要求完整观看才发奖 | 公开参数未列请求 ID、实例代次、奖励交易号、签名收据或可信时间戳 | [S12][S05] |
| `RewardedVideoAd.onError(listener)` | `errMsg: string`、`errCode: number`；文档列 1000–1008 | 未提供加载／展示阶段字段或请求关联 ID；未保证与 Promise rejection 互斥或有固定顺序 | [S11] |
| `offLoad(listener)`、`offError(listener)`、`offClose(listener)` | 可移除对应监听；传入时需为原函数引用，不传会移除全部对应监听 | 移除监听不等于清空底层待投递事件 | [S19][S20][S14] |
| `RewardedVideoAd.destroy()` | 销毁实例、释放资源 | 未公开 `onDestroy`；未承诺触发 `onClose`、取消所有待投递事件或形成下一次展示的隔离屏障 | [S13] |

补充边界：

- 已查公开对象没有独立的 `onStart`、`onPlay`、`onVideoComplete` 或 `onReward`。**缺少真实 started 信号时不得自行创造 SDK `onStart`。**真实 `show()` resolve 最多映射为项目事件 `DISPLAYED`。[S07][S09]
- 教程说明开发者不能主动隐藏／关闭正在展示的激励视频。不能把项目 `cancel`、`timeout`、`dispose` 描述成 SDK 强制关广告的能力，也不能承诺 `destroy()` 会替代用户关闭。[S05][S13]
- `onError` 的代码包括：1000 接口失败、1001 参数错误、1002 广告单元无效、1003 内部错误、1004 无合适广告、1005 审核中、1006 驳回、1007 封禁、1008 广告单元关闭。无填充属于需兼容的结果，不得阻断游戏。[S11]
- **完整回调顺序、唯一投递、销毁后静默、前后台恢复后的回调边界：均未核实官方保证。**代码示例的书写顺序不是事件协议；也不能用通用 JavaScript Promise 顺序规则替代原生桥回调合同。[S05][S07]—[S14]

### 1.3 文档差异与日期

- **单例／multiton 差异**：教程和对象总览称生命周期内单例；创建 API 列出 `multiton`（默认 false）。默认单例有文档依据；多例是否在目标版本真正隔离底层广告及回调仍待验证。调用多次创建、换监听、传 `multiton: true`、换 JS 对象引用，都不是已证明的隔离措施。[S05][S06][S07]
- Dirichlet 小游戏专页列激励视频、插屏、横幅三类；小游戏广告总览另列原生模板广告。MVP 仅规划激励视频，不据此扩展其他类型。[S04][S18]
- 三份指定入口正文没有发现明确发布日期／修订日期。当时响应的 Last-Modified 为 2026-10-09 04:52:35 GMT；这是服务器文件元信息，**不是规范生效日期**。SDK 下载页的资源更新日期也不能替代 JS 版本核实。[S01][S02][S03][S16]

## 2. 官方广告要求与项目保守策略分开记录

### 2.1 官方要求／建议

| 来源 | 要求或建议 | 不应作出的推论 |
| --- | --- | --- |
| 小游戏广告审核规范 | 首次启动后的 **60 秒内或第 1 个关卡内**不得展示任何广告 | 玩家主动点击不构成绕过首次体验限制的理由 | 
| 同一规范 | 首次启动后的 **120 秒内或前 3 个关卡内**，强制打断游戏进程的全屏广告不得超过 **1 条** | 不等于“激励视频每 120 秒一次” | 
| 同一规范 | 激励视频由玩家选择；展示前明确规则及完整观看后的奖励；避免误点和遮挡广告内容 | 不能自动弹激励视频或以广告拦截基本游戏流程 | 
| 原生小游戏广告总览 | 插屏间隔建议 2–3 分钟以上 | 不是激励视频的硬性冷却时间 | 
| Dirichlet FAQ | 未设单用户观看上限，建议每日十次以内 | 不是平台“每日最多十次”的硬限制 | 

来源：[S02][S18][S17]。MCP 页另有插屏间隔 ≥2 分钟的提示，但其适用范围不同，不作为本项目原生广告的独立审核规则。[S03]

官方公开文字没有进一步细化“一波是否算一关”、首次启动跨重装的判定、计时细节等。本项目不自行给出具有平台效力的解释。MVP 不实现插屏、开屏或任何强制全屏广告。

### 2.2 项目策略 V0.1（我们自己制定，可调，不是 SDK 默认值）

| 策略项 | 初始设计 | 计数／边界 |
| --- | --- | --- |
| 首局保护 | **首局全程禁广告** | 包括准备、失败、战利品、首领及该局结算；不是只屏蔽开局 60 秒 |
| 首次体验门槛 | **至少 60,000 ms 有效前台体验** | 与首局保护同时满足后才允许提供真实广告；不以离线墙钟差值累计 |
| 后续展示间隔 | 候选 **90 秒有效前台体验** | 从上一条广告结束并恢复可交互前台后计；后台、广告播放、离线不抵扣；首次无历史展示时无前序间隔 |
| 每日展示预算 | 候选 **每天 ≤8 次** | 是展示预算，不是完播次数；未完播也占已展示名额；为项目体验策略，非平台上限 |
| 展示并发 | 最多一个原生广告尝试 | 按钮连点、不同场景、不同广告位不能并发；未知终态时禁止启动下一条真广告 |
| 自动行为 | 不自动弹出、不自动恢复播放、不循环重试展示 | 重试须重新确认玩家意愿和资格；广告失败保留普通流程 |

保护状态设计：

1. 第一局正常胜／负结算并成功存档后，才允许将“首局教学保护已完成”写入存档。中断、强退、放弃未完成局不提前解除保护，属于项目保守选择。
2. 该受保护局携带持久化的禁广告标记；即使结算事务同时解除全局首局保护，**这个结算仍不显示双倍奖励广告**，重新打开该结算也不能绕过。
3. `60s` 门槛与首局保护是 AND 关系。完成首局但有效体验不足，或已体验 60s 但尚处首局，都禁广告。
4. 候选 90s／8 次可以通过有版本的项目配置调整，但不能放宽官方硬要求。Mock 的测试越权配置不得写入真实策略存档。

### 2.3 有效前台计时与离线墙钟风险

以下全部为项目计时设计，不是已经核实的 TapTap 计时 API：

- 依赖 `ForegroundExperienceClock` 项目端口，底层必须选择并验证可用的单调时间源。尚未验证时保持真实广告关闭，不伪造 SDK 方法名。
- 仅在应用可见、获得交互条件、游戏／教程处于可交互状态时累计；广告展示、后台、显式暂停、启动加载、退出和离线不累计。
- hide 时停止累计；show 时重设采样基线。不能用“恢复时间减隐藏时间”增加体验时间。
- 连续可信采样才计入：负差值、零回退或超过候选 `2,000 ms` 的采样空档按 0 计并重设基线，而不是把长时间挂起计入。2,000 ms 是可调的项目保守参数。
- 已累计体验随全存档持久化，首次门槛字段可封顶 60,000 ms。重新启动仅读取验证有效的已存值，不加 `Date.now() - lastExitWallTime`。没有成功持久化的时间允许少计，不允许凭墙钟补计。
- 设备日期前调／后调、时区改变、离线几天都不得直接解除首局保护或 60s 门槛。存档缺失／损坏／版本未知时广告资格保守关闭，不通过清空背包等方式“修复”。
- 90s 冷却也用可信前台增量；若上一条是否展示／结束仍不确定，冷却到期不能替代终态隔离。
- 每日预算按项目业务时区 Asia/Shanghai 管理，但**设备墙钟不是可信日期凭证**。不得因任意日期变化创建新预算桶；异常回拨、跳日或离线跨日无法验证时，保留旧桶，不额外赠送展示预算。真实日界重置需经验证的可信日期／连续时间策略；没有该能力时，预算用尽暂停真广告，普通游戏照常，不因此新增复杂服务端。
- 单机存档不能证明“设备时间／本地数据绝不被篡改”。≤8 次是项目本地策略，不宣称抗作弊的跨设备强保证；每日重置能力属于真实接入门禁。

展示预算：在可能调用真实 `show()` 前，持久化预留一个名额，防止双击或进程终止后未计数。只有可信确认未展示时才可释放一次；调用后结果未知不自动退款。`DISPLAYED`、模拟 started、完播及重复回调不能对同一预留重复计数。

## 3. 三种奖励的业务合同

所有名称、rewardKey 格式和字段均是项目设计，不是平台广告单元 ID 或 SDK 字段。

| 项目 placement | 次数与条件 | 稳定业务 rewardKey 示例 | 增量效果 |
| --- | --- | --- | --- |
| `RUN_REVIVE` | **每局最多成功复活 1 次**；原局仍处于可复活的失败机会 | `run/<runId>/revive` | 提交原局复活状态与已使用次数；具体生命恢复数值由玩法配置定义 |
| `RUN_LOOT_REROLL` | **整局战利品重抽最多 1 次，不是每波 1 次**；原战利品机会仍有效 | `run/<runId>/loot-reroll` | 原子替换该机会的候选池，并消费整局重抽资格；原候选在提交前保留 |
| `SETTLEMENT_BASE_BONUS` | **每个结算最多补发 1 次本局 baseCoins**；基础结算已经独立完成 | `run/<runId>/settlement/<settlementId>/base-bonus` | 仅执行 `wallet += frozenBaseCoins`；不得钱包乘二，不得把其他广告金币再次翻倍 |

业务不变量：

- 基础金币先由普通结算幂等发放，不依赖广告。广告按钮显示的额外数额来自结算时冻结的 `baseCoins`，不是当前钱包余额。
- runId／settlementId 必须在展示前稳定持久化，恢复场景、重试、换广告位或刷新 UI 不得重新生成等价业务的新 key。
- `attemptId` 每次请求独立生成，用于尝试日志与状态；**不放入 rewardKey**。同一机会重试三次仍只能结算一个业务奖励。
- SDK 未完播、归属不可信或广告失败，不消费业务奖励资格；展示预算与奖励资格是不同计数。但机会已经失效时不得把资格重新解释为新局／新波的奖励。
- 加载广告时保留旧战利品候选、背包、暂存区和所有未放入物品；失败／取消返回原选择。重抽、奖励提交失败都不能删除或吞掉物品。
- 替换候选、推进随机数状态、记录重抽已使用，必须与该 rewardKey 的领奖记录一致提交，避免重复回调重新抽到另一组结果。
- 普通选择／结束本局等操作如果在广告展示前改变上下文，应取消旧展示意图；之后旧回调不得复活新局、重抽新波或改写新结算。
- 如果可信完成证据对应的原业务窗口已失效，只保留原机会的待处理记录，不跨机会发奖、不擅自换成金币、不回滚新局物品。此类恢复体验须在真实接入前验证，不能借“补偿”绕过归属校验。

## 4. 项目接口与事件（全部为自定义设计）

### 4.1 模块职责

| 项目内部名称 | 职责 | 明确不具备的能力 |
| --- | --- | --- |
| `AdService` | 查询可用奖励、处理玩家主动请求、串行协调、返回可解释状态 | 不直接改变战斗、背包或钱包；不是 TapTap API |
| `MockAdService` | 使用可控模拟提供方和同一业务协调器的开发组合 | 不产生真实广告播放、SDK 收入或真实平台审核结论 |
| `TapNativeAdProvider` | 唯一允许接触真实 `tap.*` 广告对象的边界；保存原始事件 | 未核实前不实现不存在的 start／requestId／销毁完成回调 |
| `AdPolicy` | 首局、有效前台体验、冷却、展示预算和用户意愿校验 | 不以失败／超时伪造完播；不替代平台审核 |
| `NativeAttemptBoundary` | 串行、实例边界、终态隔离、无法归属时隔离停用 | 不把监听闭包里的 attemptId 当成 SDK 回传证据 |
| `RewardCoordinator` | 校验原机会和业务 key，协调证据持久化与奖励幂等提交 | 不驱动广告、不用动画完成回调决定发奖 |
| `SaveRepository.commitWholeSave` | 在预期版本基础上提交完整存档快照，并支持提交结果核对 | 此名称不是平台存储 API；底层原子性／恢复能力必须实测 |
| `ForegroundExperienceClock` | 可测试的单调前台累计时间 | 不能将离线墙钟差额当成体验 |

可供 UI 使用的项目合同名称为 `getRewardOffer`、`requestRewarded`、`cancelPendingRequest`、`dispose`；这些是拟议接口而非已实现函数。取消仅撤销尚未展示的意图或标记业务放弃，不承诺主动关闭原生视频。真实／Mock 都必须经过同一 `RewardCoordinator` 与存档不变量，不能给 Mock 开一条直接加钱的捷径。

### 4.2 自定义事件语义

| 项目事件 | 来源／含义 | 可否作为发奖依据 |
| --- | --- | --- |
| `REQUESTED`、`LOAD_REQUESTED`、`SHOW_REQUESTED` | 项目记录了相应动作 | 否 |
| `LOADED` | 加载操作／素材准备信号 | 否，不能自动展示 |
| `DISPLAYED` | 真实 `show()` resolve 或模拟展示成功 | 否；仅为显示操作成功，不是 started |
| `PRESENTATION_STARTED` | **仅由显式 Mock 步骤产生**；若未来真实平台有正式依据，另行扩展适配 | 否；当前真实适配不得从 DISPLAYED 推导此事件 |
| `COMPLETION_CANDIDATE` | 收到原始关闭信号，等待严格值、归属、业务条件核验 | 否 |
| `COMPLETED` | 通过可信归属校验且 `isEnded === true` 的候选被业务层接受；仍待可靠存档 | 不能单凭动画／该事件增加资产，必须走事务 |
| `SKIPPED` | 可信关闭结果为 `isEnded === false` | 否 |
| `UNKNOWN_CLOSE` | 参数缺失、类型错误或归属不明 | 否；不兼容性地将 undefined 视为完播 |
| `ERROR` | 加载、展示或未知阶段错误；保留原始 errCode／errMsg | 否；SDK onError 本身不带阶段，不能凭猜测消耗当前奖励 |
| `TIMEOUT` | 项目期限到达 | 否，也不是原生关闭确认 |
| `APP_HIDDEN`、`APP_SHOWN` | 项目生命周期通知；实际底层回调由运行时适配验证 | 否，不表示跳过、完播或重新播放 |
| `DISPOSE_REQUESTED`、`DISPOSED` | 项目申请／完成自身监听和引用的清理 | 否；不是 SDK onDestroy，也不证明原生消息队列已排空 |
| `QUARANTINED` | 回调归属／终态不确定，隔离真实广告能力 | 否；普通游戏仍可用 |
| `REWARD_COMMITTED` | 全存档中的 ledger 与增量奖励已核对成功 | UI 可据此表现奖励，但不再次结算 |
| `PERSISTENCE_FAILED` | 存储失败或提交结果不明，进入核对／重试 | 否；不再次播放广告来“重试领奖” |

诊断 envelope 可包含项目生成的 attemptId、rewardKey、对象代次、单调观测时间、providerKind、事件来源、原始 payload 和归属置信状态。**这些元数据是我们附加的，不是 SDK 返回字段；置信状态不能因贴了 attemptId 就自动变可信。**

内部流程可以设计为请求→准备→请求展示→等待终态→记录证据→提交奖励，但不能强制真实回调按这个全序到达：

- 在已经发起 SHOW_REQUESTED、归属已独立证明的前提下，可信 onClose(true) 先于 show Promise resolve 到达，不应仅因顺序不同漏发；后来的 DISPLAYED 不得重新打开终态或再次计数。
- 在尚未请求展示时收到完成候选，或错误／完成互相矛盾且无法归因，进入隔离，不能先发钱再补理由。
- 已提交奖励后来的错误不能回滚金币；下一份素材的自动加载失败不能推翻上一份已确认的完成结果。
- **真实 started 信号不是发奖前置条件。**当前平台没有该公开回调，可信完播不需要编造一条 started 来凑齐状态机。

## 5. 最重要的风险：无请求 ID 的跨单例迟到回调

### 5.1 为什么给 listener 闭包贴 attemptId 不够

可能的错误轨迹：

1. 尝试 A 调用 show，随后超时／切场景，项目移除 listener A。
2. 项目以为 A 已结束，在同一个底层单例上安装 listener B；B 的闭包捕获 attemptId B。
3. A 的旧 onClose({isEnded: true}) 此时才被底层投递到当前监听。
4. listener B 给该消息贴上 B 的 attemptId，导致 **B 冒领 A 的完播**。

公开 onClose 参数没有请求 ID，JavaScript 闭包只知道“谁在接收”，不知道“哪次原生展示产生”。换 listener、换业务当前指针、等待 90 秒、调用 destroy 再 create，都不能单独证明上述情况不会发生。即便 A 已正常关闭，迟到的重复关闭仍可能形成同类风险；本次没有官方全序／唯一回调保证。[S06][S07][S12][S13]

### 5.2 在恢复边界验证前的强制保守策略

- `realAdsEnabled` 默认 false。真实广告上线前必须通过第 9 节门禁；Mock 正常开发不等待真 SDK。
- 原生展示严格串行。项目终态和 SDK 原生隔离边界是两个概念：**业务标记结束不等于可以安全开始 B**。
- 请求一旦发起 show 而缺乏可信关闭／隔离证明，进入持久化的隔离状态；暂停后续真广告，不让新请求接管旧回调通道。
- 正常结束也只能在已经验证的实例生命周期／底层去重边界下复用。多例、destroy+create、场景重建、hide/show、应用重开都不能未经验证地解除隔离。
- 收到迟到事件，只能针对其可信证明的原尝试与原 rewardKey 处理；不能证明归属就记录为 UNKNOWN／QUARANTINED，**绝不归给“当前最新请求”**。
- 移除监听只使用本模块持有的原函数引用，避免无参 off 意外移除其他监听；清理不构成回调安全屏障。
- 只有能够证明“从未发起展示，且没有历史未决原生展示”的取消，才可能按未展示处理；无法证明就保持隔离。
- 恢复条件须来自已验证的平台生命周期／隔离方案或官方明确合同，而不是固定等待时间。若目标运行时无法提供可用隔离，保留暂停真广告的降级，不牺牲奖励归属安全。
- 隔离仅关闭激励入口。普通战利品选择、放弃复活后的普通结算、下一局、存档、装备和基础金币都必须继续可用。

## 6. 领奖事务、恢复和保证范围

### 6.1 奖励成立条件

必须同时满足：玩家主动选择；项目／平台策略允许；该尝试确实请求过展示；原始 `isEnded === true`；归属独立可信；原业务机会仍可应用；稳定 rewardKey 尚未发放；存档状态可核对。

`true` 字符串、1、undefined、缺失参数、只有 show.resolve、播放动画结束、超时、hide/show 和不明旧回调都不满足。已看过广告不意味着可以不经证据核验跨局补发。

### 6.2 全存档与提交顺序

拟议全存档包含版本／revision、玩家资产、当前局、结算、背包与暂存物品、广告策略、尝试／可信证据记录和 rewardLedger。字段均是项目设计；未知兼容字段不能因广告模块写快照而被丢弃。

1. **展示前**：持久化原尝试的 rewardKey、原 run／opportunity／settlement 标识、冻结 baseCoins 或战利品机会快照、配置版本及预算预留。展示前持久化失败则不调用真实 show，普通玩法照常。
2. **可信完成证据**：严格校验值与归属，将原尝试的可信证据记录到同一个全存档中（项目状态 EVIDENCE_RECORDED）。不可信 payload 可以写诊断，但不能冒充可信证据。此时仍未增加奖励资产。
3. **奖励提交**：读取最新完整存档、检查 revision 与原机会，构造一个候选全快照，**在同一次全存档事务中提交 rewardLedger 条目 + 增量奖励 + 使用次数／RNG／候选池等关联状态**。绝不先单独写 ledger 再单独加钱，也不先加钱后补 ledger。
4. **结果核对**：提交成功后才接受 REWARD_COMMITTED 并更新可见状态／播放动画。存储抛错不一定表示“从未写入”；如结果不明，先重读权威完整快照，以 revision、ledger 和关联状态核对，不盲目回滚或重发。
5. **幂等恢复**：同一 rewardKey 已提交则返回原结果，不追加资产。只有可信证据已持久化而 ledger 未提交时，才可对同一原机会重试提交，不重新看广告、不生成新 rewardKey。
6. **并发冲突**：若期间普通玩法已有存档，必须重读后校验／合并合法增量；禁止用旧广告快照覆盖新背包、新局、其他金币收入或未知字段。上下文失效时保留原待处理记录，不套给新机会。

SaveRepository 的原子全快照／并发版本／崩溃恢复能力是待实现并实测的项目合同，**不是对尚未核实的平台存储 API 作原子性承诺**。在相关验证失败时，应关闭真广告而不是接受半领奖状态。

### 6.3 崩溃窗口：不能夸大 exactly-once

| 崩溃／失败位置 | 恢复处理 | 能保证什么／不能保证什么 |
| --- | --- | --- |
| 展示前预留失败 | 不展示，保留普通游戏和原机会 | 不用存储失败消耗业务奖励 |
| 已完整观看，但进程死于记录可信证据之前 | 重启没有可靠完播证据，不能仅凭曾经请求／显示过广告补发 | **单机无法同时保证永不漏发和永不误发；此处可能漏发，必须承认** |
| 可信证据已持久化，奖励未提交 | 对原 rewardKey 和仍有效的原机会重放提交 | 不重新播放广告，不把原奖励转给新局 |
| ledger + 增量奖励已提交，动画尚未播放 | 读取已提交结果；可恢复表现，但不再次加资产 | 发奖与表现分离 |
| 写入成功但回执丢失／提交结果不明 | 重读并核对全存档，再决定是否重试 | 不因异常回调重复加钱 |
| 存档损坏／未知版本／原机会不可应用 | 隔离广告领奖，保留可恢复数据与诊断 | 不清空装备，不伪造完成，不承诺无条件补偿 |

本设计目标是：在可信证据、稳定业务 key 和已验证持久化合同下实现**可恢复的幂等业务提交／最多一次资源增量**。这不是广告播放与本地存档之间的分布式事务，也不承诺端到端 exactly-once、用户改存档不可作弊、清数据后不重复或所有完播必然到账。

## 7. 可控 MockAdService 设计

### 7.1 默认与隔离

- 默认 `MANUAL／UNCONFIGURED`：没有显式选择脚本或手动结果时，返回可解释的 UNAVAILABLE／未配置状态，**不默认成功、不自动发奖、不回退到真广告**。
- 模拟界面必须持续标明“开发模拟广告，不是真实广告，不产生真实收入”。模拟完播仅用于验证游戏内奖励与状态机。
- Mock 与真实运行使用隔离的配置、策略／奖励账本命名空间或隔离测试存档；Mock 的“已看完”不能写入正式广告证据或正式奖励记录。共享的是奖励算法，不是生产数据。
- 不生成真实收入字段；realRevenue 为不可用／未采集，不以游戏金币、完播次数乘常数或虚构 eCPM 填充。广告收入只能来自实际平台结算／报表，本文未接入报表。

### 7.2 脚本能力

项目测试脚本可以控制：加载完成／失败、show resolve／reject、显式模拟 PRESENTATION_STARTED、关闭 true／false／缺失参数、通用错误、重复消息、乱序、无回调、超时、hide/show、dispose、进程重启以及持久化各提交点的失败。脚本格式、时钟、队列和动作名称均属测试工具设计，不是 SDK 接口。

- 注入 FakeClock，分别控制单调时间、有效前台状态和墙钟，禁止靠真实等待 90 秒完成测试。
- 每条脚本可指定生成时刻、投递时刻、原始 payload 和测试预言机中的真实产生方，模拟“事件由 A 产生却投递给当前 B listener”。
- 设置两种测试通道：有可信模拟关联的业务验证通道；**不带请求 ID 的单例对抗通道**。对抗通道不能偷偷给被测适配器附上真实 SDK 没有的 producerAttemptId；产生方只供测试预言机断言。
- 模拟 started 必须显式触发。真实平台能力配置为 started 未支持／未核实时，即便 show resolve 也不得生成 PRESENTATION_STARTED，更不能创造 onStart 方法。
- 可注入自动预加载：旧广告关闭后出现下一份 onLoad／onError，但不得自动启动新展示或污染上一份奖励。
- `timeout`、`cancel`、`dispose` 只结束项目等待／意图和清理本模块资源。它们不是“原生视频已经关闭”的模拟捷径；对抗通道仍能投递迟到事件。

### 7.3 普通流程与表现

- 加载失败、无填充、展示失败、跳过、资格不足：给出短提示并保留不看广告的主操作。不能将整个战利品页／结算页锁死，也不能循环弹广告。
- 播放期间可暂停战斗／音频；后台不推进有效体验。恢复音频和表现需等前台可交互，不从展示成功推断媒体真实开始。
- 超时释放项目自己的等待界面与普通继续路径，但不宣称能强制关闭原生覆盖层；无法确认终态时仅暂停后续真广告。不能让后台自动战斗消耗玩家装备或生命以“解除阻塞”。
- REWARD_COMMITTED 才触发奖励表现。动画中断／重播／切场景不能改变发奖次数。

## 8. Mock 自动测试清单

**执行状态说明：下面 60 个情景全部为 NOT_RUN。**本任务只写设计文档；未创建测试代码、未运行 Mock、未做 SDK／真机测试。每次后续执行需记录实现版本、脚本／种子、存档前后摘要、事件轨迹和实际结果，不能凭代码审阅改为 PASS。

### 8.1 策略与业务边界

| 编号 | 情景／注入 | 预期断言 | 当前状态 |
| --- | --- | --- | --- |
| AD-MOCK-001 | 无脚本、未选择手动结果 | 返回 UNAVAILABLE／未配置；零奖励、零真实展示，普通游戏可继续 | NOT_RUN |
| AD-MOCK-002 | 首局已玩超过 60s，在失败、战利品和结算尝试广告 | 全部禁止；结算解除保护也不使该局结算可看广告 | NOT_RUN |
| AD-MOCK-003 | 首局结算已完成，但有效前台累计仅 59,999ms；随后增加 1ms | 前者禁止；仅其余资格均满足时后者可提供入口 | NOT_RUN |
| AD-MOCK-004 | hide 后等待、退出离线数天再 show | 不累计后台／离线时长；重设采样基线，不绕过首局／60s | NOT_RUN |
| AD-MOCK-005 | 墙钟向前一年、向后一年、切时区 | 首次门槛不变；不凭日期跳变新增每日预算 | NOT_RUN |
| AD-MOCK-006 | 单调时间负差值或采样空档超过 2,000ms | 不增加体验时间，重设基线；不因长挂起解锁广告 | NOT_RUN |
| AD-MOCK-007 | 正常存档后重启；另注入计时字段损坏／未知版本 | 正常仅恢复已存累计；异常保守禁广告而非清空装备 | NOT_RUN |
| AD-MOCK-008 | 上次结束后 89,999ms／90,000ms 有效前台，夹杂后台时间 | 冷却按可信前台判断；隔离未解除时即使 90s 到也禁止真广告 | NOT_RUN |
| AD-MOCK-009 | 同预算桶请求第 8／第 9 次展示；第 8 次提前关闭 | 已展示的跳过仍占名额；第 9 次被拒；重复事件不多扣 | NOT_RUN |
| AD-MOCK-010 | 预留预算后可信加载失败；另一次 show 后结果未知 | 前者可释放一次；后者不自动退款、不开放下一条真广告 | NOT_RUN |
| AD-MOCK-011 | 同时点击复活／重抽或连点广告按钮 | 最多一个尝试和一次预算预留；基本操作不被永久锁住 | NOT_RUN |
| AD-MOCK-012 | 一局成功复活后再次失败；新一局尚未使用 | 原局第二次禁止；新局仅在全部广告策略通过后有自身一次资格 | NOT_RUN |
| AD-MOCK-013 | 第 2 波已广告重抽，第 3／4 波再次请求 | **整局**重抽资格已耗尽，不按波刷新；装备和旧候选不丢失 | NOT_RUN |
| AD-MOCK-014 | 基础结算已到账，钱包 1000，冻结 baseCoins=30 | 仅补发到 1030；不是 2000；重复领奖保持 1030 | NOT_RUN |
| AD-MOCK-015 | 请求后切换 run／offer／settlement，旧机会失效 | 旧奖励不映射到新局、新波或新结算；保留物品及诊断 | NOT_RUN |

### 8.2 加载、展示、开始、完成与异常顺序

| 编号 | 情景／注入 | 预期断言 | 当前状态 |
| --- | --- | --- | --- |
| AD-MOCK-016 | 仅 load 成功／onLoad，未有玩家展示意图 | 无自动 show、无 started、无奖励 | NOT_RUN |
| AD-MOCK-017 | load rejection，并保留原战利品池和未放入装备 | 不 show、不发奖，原候选／背包／暂存物品完全保留 | NOT_RUN |
| AD-MOCK-018 | load 永不返回直至超时 | 不把超时当成功；释放项目等待，普通选择可用 | NOT_RUN |
| AD-MOCK-019 | load 成功后 show rejection | 不发奖，不伪造 DISPLAYED／started；按可信曝光状态处理预算与隔离 | NOT_RUN |
| AD-MOCK-020 | show resolve，但没有关闭／完播消息 | 仅 DISPLAYED；零奖励，不能派生 onStart／PRESENTATION_STARTED | NOT_RUN |
| AD-MOCK-021 | 手动触发模拟 PRESENTATION_STARTED | 显式标为 Mock；不结算奖励、不记真实收入 | NOT_RUN |
| AD-MOCK-022 | 真实能力形态没有 started；可信关联的 onClose(true) 到达 | 不要求伪造 started；经完整事务最多发放一次 | NOT_RUN |
| AD-MOCK-023 | onClose({isEnded:false}) | SKIPPED；不奖励、不消耗业务次数，普通流程继续 | NOT_RUN |
| AD-MOCK-024 | onClose 参数为 undefined／null／{}／isEnded 为字符串 true 或 1 | 严格拒绝完播判定；零奖励，归入未知／无效结果 | NOT_RUN |
| AD-MOCK-025 | show 已请求、归属可信、isEnded 严格为 true、业务有效 | 记录可信证据；ledger 与增量奖励一致提交一次，随后才表现 | NOT_RUN |
| AD-MOCK-026 | 参数化注入 errCode 1000–1008，特别是 1004 无填充 | 保存原始错误；不伪造完播、不阻断普通游戏 | NOT_RUN |
| AD-MOCK-027 | 同一加载错误同时触发 Promise rejection 和 onError | 不重复消费预算／业务次数，不重复终结或弹循环提示 | NOT_RUN |
| AD-MOCK-028 | 同一展示错误同时触发 show rejection 和 onError | 单次错误处理；未能确定是否展示则隔离，不自动再 show | NOT_RUN |
| AD-MOCK-029 | 重复 onLoad；关闭后下一份素材自动 onLoad | 不增加请求数、不自动展示、不发奖、不额外扣展示预算 | NOT_RUN |
| AD-MOCK-030 | 同一可信尝试重复 onClose(true)，含事务提交前后到达 | 同 rewardKey 最多一个成功提交，奖励和 RNG 不重复推进 | NOT_RUN |
| AD-MOCK-031 | SHOW_REQUESTED 后可信 onClose(true) 先到，show resolve 后到 | 不因顺序变化漏掉有效候选；迟到 DISPLAYED 不重开终态、不二次发奖 | NOT_RUN |
| AD-MOCK-032 | SHOW_REQUESTED 之前就收到完成候选 | 不奖励，记录矛盾／隔离，不靠闭包补造展示历史 | NOT_RUN |
| AD-MOCK-033 | 完成并提交后，旧错误或下一份预加载错误到达 | 不回滚已发奖励，不重复发奖，不启动新广告 | NOT_RUN |
| AD-MOCK-034 | 明确失败后再到完成，无法判断是否旧广告事件 | 不归给最新尝试，不自动发奖；保留不确定记录并隔离 | NOT_RUN |
| AD-MOCK-035 | show 后永久无终态，触发项目超时 | 超时不奖励、不冒充关闭；普通流程可用，下一条真广告暂停 | NOT_RUN |
| AD-MOCK-036 | 超时后迟到 DISPLAYED 或关闭信号 | 不重开当前指针；仅可信归属的原机会可处理，未知信号不发奖 | NOT_RUN |

### 8.3 hide/show、dispose 与跨单例对抗

| 编号 | 情景／注入 | 预期断言 | 当前状态 |
| --- | --- | --- | --- |
| AD-MOCK-037 | 广告加载期间 APP_HIDDEN，完成后 APP_SHOWN | 不后台 show、不恢复即自动 show；重新校验意愿与资格 | NOT_RUN |
| AD-MOCK-038 | 展示期间 hide/show 多次 | 不重放广告、不产生 started／完成，不把后台计入有效体验 | NOT_RUN |
| AD-MOCK-039 | 可信完成存档过程中 hide/show／切场景 | 事务与动画分离；恢复只表现已提交结果，不重复加资产 | NOT_RUN |
| AD-MOCK-040 | dispose 后仍投递 load／error／close | 清理不等于底层取消；不让迟到消息进入新业务机会 | NOT_RUN |
| AD-MOCK-041 | 重复 dispose／解绑，另有非本模块监听 | 本模块清理幂等；不无参 off 删除他人的监听；不宣称收到 SDK onDestroy | NOT_RUN |
| AD-MOCK-042 | A 超时移除监听，申请 B；底层将 A 完成投递到“当前监听” | 接入边界应阻止 B 原生展示；无 ID 的完成不能靠 B 闭包变可信；B 零奖励 | NOT_RUN |
| AD-MOCK-043 | A 正常完成后延迟重复完成，已等待 90s，再申请 B | 90s 不作为隔离证明；A ledger 仍一次，B 不能冒领 A 的完播 | NOT_RUN |
| AD-MOCK-044 | 配置 multiton=true 或返回不同 JS 对象，但未验证底层隔离 | 不自动通过真实恢复门禁，不凭对象不同信任事件归属 | NOT_RUN |
| AD-MOCK-045 | QUARANTINED 后 destroy/create、重建场景、hide/show 或重启 | 不未经已验证恢复流程解除隔离；继续保留普通游戏 | NOT_RUN |
| AD-MOCK-046 | 同一 rewardKey 使用不同 attemptId 重试；旧尝试完成迟到 | 不生成新领奖额度；归属未知不奖励，可信同 key 也最多一次 | NOT_RUN |

### 8.4 事务、崩溃、资产安全与配置

| 编号 | 情景／注入 | 预期断言 | 当前状态 |
| --- | --- | --- | --- |
| AD-MOCK-047 | 展示前预留／上下文存档失败 | 不调用真实 show；不扣业务资格，不丢装备，普通游戏可继续 | NOT_RUN |
| AD-MOCK-048 | 可信证据持久化失败 | 不提前加奖励；保留可重试状态／诊断，不再看广告来重试存档 | NOT_RUN |
| AD-MOCK-049 | 奖励全快照在写入前失败 | ledger、钱包、使用次数、候选池及 RNG 都不出现半提交 | NOT_RUN |
| AD-MOCK-050 | 全快照写入成功但成功回执丢失 | 重读 revision／ledger 核对，返回原结果，不重复加钱或重抽 | NOT_RUN |
| AD-MOCK-051 | 可信证据已存，进程在奖励提交前死亡 | 原机会仍有效时恢复同 rewardKey 的一次提交；不归给新机会 | NOT_RUN |
| AD-MOCK-052 | ledger+奖励已存，进程在动画前死亡 | 恢复资产保持一次，可恢复表现但不再次结算 | NOT_RUN |
| AD-MOCK-053 | 完播后、可信证据落盘前杀进程 | 恢复不能自动证明完播，不擅自补发；明确该窗口可能漏发 | NOT_RUN |
| AD-MOCK-054 | 普通玩法先提交新背包／金币，广告使用旧 revision 提交 | 版本冲突后重读；不以旧快照覆盖新资产、暂存物品或未知兼容字段 | NOT_RUN |
| AD-MOCK-055 | 损坏存档、未知 schemaVersion、ledger 与资源不一致 | 隔离广告恢复并保留数据；不清空物品、不凭异常自动补奖 | NOT_RUN |
| AD-MOCK-056 | 重抽候选生成后提交失败；重试与重复关闭交错 | 失败保留原池，成功只替换一次；RNG 状态与整局次数同事务提交 | NOT_RUN |
| AD-MOCK-057 | 已补发 baseCoins 后获得其他金币，再重复结算广告回调 | 其他收入保留；不对钱包乘二、不重复补发 baseCoins | NOT_RUN |
| AD-MOCK-058 | 真实广告 ID 缺失、未审核或配置类型不匹配 | 不臆造 ID、不静默换其他平台 SDK；关闭奖励入口，保留普通流程 | NOT_RUN |
| AD-MOCK-059 | Mock 完成／跳过／失败若干次，检查日志与生产存档 | 模拟标识完整；无真实收入记录、无生产领奖／策略数据污染 | NOT_RUN |
| AD-MOCK-060 | 对抗通道只提供官方原始字段，同时尝试派生 onStart／sdkRequestId | 不向被测适配器注入不存在的官方字段；show resolve 只能 DISPLAYED，归属未证实不得发奖 | NOT_RUN |

## 9. 真实实现接入门禁（均未通过）

| 门禁 | 必须获得的证据 | 当前状态 |
| --- | --- | --- |
| REAL-GATE-01 产品／版本 | 官方确认原生小游戏目标端广告能力、最低运行时／TapTap 版本；如确需独立 JS SDK，补齐正式获取路径、版本和导入方式 | NOT_RUN |
| REAL-GATE-02 后台／广告位 | 主体与协议、小游戏媒体、真实激励广告位、测试工具、审核与启用状态核验；不使用虚构 ID | NOT_RUN |
| REAL-GATE-03 基础回调 | 目标真机验证 load、show、关闭 true／false、缺失结果、错误、无填充、自动预加载；不声称存在官方 started | NOT_RUN |
| REAL-GATE-04 归属／隔离 | 官方合同与真机事件轨迹共同验证单例／multiton、重复与迟到、destroy、跨场景和前后台恢复边界；不能仅靠测试没复现就宣称 SDK 永不乱序 | NOT_RUN |
| REAL-GATE-05 存档事务 | 全快照原子性、版本冲突、写入结果不明、证据／奖励各崩溃点、物品完整性与幂等恢复 | NOT_RUN |
| REAL-GATE-06 策略／时钟 | 首局全禁、有效前台 60s、90s 候选冷却、每日预算与可信日界处理；时间跳变不能解锁首次广告 | NOT_RUN |
| REAL-GATE-07 正常游戏降级 | 任意广告失败、未知终态与隔离状态不锁普通流程、不吞装备、不丢基础金币；真实平台覆盖层不能被错误宣称可强关 | NOT_RUN |
| REAL-GATE-08 审核体验 | 玩家主动选择、奖励说明清楚、首次体验规则、可放弃路径、屏幕与前后台表现审核 | NOT_RUN |

Dirichlet 后台的公开流程是：主体／账户资料及协议→创建媒体与推广位→技术接入与测试→测试推广位转正式时审核。测试工具位于“流量管理→测试工具”；正式变现前媒体和推广位均需设为正式且启用。[S04][S15]

本项目的实际账号权限、所需完整材料、测试设备配置和审核时长尚未登录后台核验。不得把普通 APP FAQ 中的开放下载、SHA1 或 keystore 当作原生小游戏必需上传 APK 的依据。[S15][S17]

在 REAL-GATE-04 未获得可靠边界前，串行仅是必要条件而非充分条件：宁可暂停后续真广告并保留游戏，也不能让新请求冒领旧完播。不存在可以靠“再等一会儿”自动通过的门禁。

## 10. 日志与验收记录设计

- 记录：构建／配置版本、providerKind、项目 attemptId、稳定 rewardKey 的诊断标识、实例代次、事件来源、原始错误码、单调观测顺序、前后台状态、归属判断理由、save revision、ledger 提交／核对结果。
- 明确区分 LOAD_SUCCESS、DISPLAYED、模拟 PRESENTATION_STARTED、可信 COMPLETED、REWARD_COMMITTED；不能以一个“广告成功”覆盖所有阶段。
- 不日志输出开发者凭证、访问令牌或不必要个人数据；模拟标识与真实环境不可混淆。
- 后续测试记录至少包括情景编号、实际脚本／种子、预期、实际、日志位置和执行日期。只有真实执行后才能从 NOT_RUN 更新，失败保留失败，不能用“代码看起来对”替代结果。
- 本文不创建日志文件或测试代码；后续保存与其他工程测试记录统一管理。

## 11. 官方来源

以下全部为一级官方来源。所有“当前”结论限于 2026-10-14 的核查，不将资料缺失解释为 SDK 永久不具备某能力。

| 编号 | 官方资料 | 用途 |
| --- | --- | --- |
| S01 | [IAA 游戏][S01] | Dirichlet 接入流程入口 |
| S02 | [小游戏广告审核规范][S02] | 首次体验、主动选择与广告样式要求 |
| S03 | [MCP 广告接入指南][S03] | 明确适用范围，不能套用原生小游戏 |
| S04 | [Dirichlet：TapTap 小游戏接入广告][S04] | 小游戏媒体类型、后台与技术链路 |
| S05 | [小游戏激励视频教程][S05] | 自动加载、展示、关闭、完整观看规则 |
| S06 | [tap.createRewardedVideoAd][S06] | adUnitId、默认单例与 multiton 参数 |
| S07 | [RewardedVideoAd 对象][S07] | 实际公开方法清单 |
| S08 | [RewardedVideoAd.load][S08] | 加载 Promise |
| S09 | [RewardedVideoAd.show][S09] | 显示操作 Promise，非完播／开始凭证 |
| S10 | [RewardedVideoAd.onLoad][S10] | 加载完成事件 |
| S11 | [RewardedVideoAd.onError][S11] | 错误参数与错误码 |
| S12 | [RewardedVideoAd.onClose][S12] | isEnded 与关闭语义 |
| S13 | [RewardedVideoAd.destroy][S13] | 销毁方法，未给回调隔离承诺 |
| S14 | [RewardedVideoAd.offClose][S14] | 解绑监听及同函数引用 |
| S15 | [Dirichlet 接入流程][S15] | 主体、测试工具、正式推广位审核和启用 |
| S16 | [Dirichlet 资源下载][S16] | 原生 APP SDK 资源；不冒充 JS SDK 版本 |
| S17 | [Dirichlet 常见问题][S17] | 观看次数建议及通用 APP 条目边界 |
| S18 | [小游戏广告总览][S18] | 广告类别与插屏最佳实践 |
| S19 | [RewardedVideoAd.offLoad][S19] | 加载监听解绑 |
| S20 | [RewardedVideoAd.offError][S20] | 错误监听解绑 |
| S21 | [Dirichlet 广告联盟介绍][S21] | 原生小游戏广告变现要求 |

[S01]: https://developer.taptap.cn/minigameapidoc/quick-start/monetization/IAA-game/
[S02]: https://developer.taptap.cn/minigameapidoc/tap-operation/operation-standards/minigame-ad-policy/
[S03]: https://developer.taptap.cn/minigameapidoc/quick-start/mcp-guide/ad-integration-guide/
[S04]: https://ssp.dirichlet.cn/docs/mini-program-guide/
[S05]: https://developer.taptap.cn/minigameapidoc/dev/tutorial/open-capabilities/ad/rewarded-video-ad/
[S06]: https://developer.taptap.cn/minigameapidoc/dev/api/ad/tap.createRewardedVideoAd/
[S07]: https://developer.taptap.cn/minigameapidoc/dev/api/ad/RewardedVideoAd/
[S08]: https://developer.taptap.cn/minigameapidoc/dev/api/ad/RewardedVideoAd.load/
[S09]: https://developer.taptap.cn/minigameapidoc/dev/api/ad/RewardedVideoAd.show/
[S10]: https://developer.taptap.cn/minigameapidoc/dev/api/ad/RewardedVideoAd.onLoad/
[S11]: https://developer.taptap.cn/minigameapidoc/dev/api/ad/RewardedVideoAd.onError/
[S12]: https://developer.taptap.cn/minigameapidoc/dev/api/ad/RewardedVideoAd.onClose/
[S13]: https://developer.taptap.cn/minigameapidoc/dev/api/ad/RewardedVideoAd.destroy/
[S14]: https://developer.taptap.cn/minigameapidoc/dev/api/ad/RewardedVideoAd.offClose/
[S15]: https://ssp.dirichlet.cn/docs/ssp-guide/
[S16]: https://ssp.dirichlet.cn/docs/resource-download/
[S17]: https://ssp.dirichlet.cn/docs/faq/
[S18]: https://developer.taptap.cn/minigameapidoc/dev/tutorial/open-capabilities/ad/ad/
[S19]: https://developer.taptap.cn/minigameapidoc/dev/api/ad/RewardedVideoAd.offLoad/
[S20]: https://developer.taptap.cn/minigameapidoc/dev/api/ad/RewardedVideoAd.offError/
[S21]: https://developer.taptap.cn/minigameapidoc/tap-operation/operation/monetization-operation/IAA/dirichlet-intro/
