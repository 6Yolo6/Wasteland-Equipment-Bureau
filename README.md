# 废土装备局 / Wasteland Equipment Bureau

**2026-10-23 · mvp-0.4.0：每波补给可暂时收起查看装备再返回领取；加入5张局外研究蓝图。309项游戏测试、44项真实浏览器回归通过。0.4.0 Windows x64免安装包从中文／空格目录实际解压启动，并再次通过44项完整回归；可交给朋友内部试玩。**

目标仍是 **TapTap 原生小游戏**。现在可运行的是同一 Cocos Creator 工程的 **Web Mobile 开发预览**，用于验证玩法与交互；它不是 TapTap 测试包，不是转做 H5 产品，也没有真实广告或收入。

## 已可玩的内容

当前：[补给收起、蓝图研究及0.4.0试玩验收](<D:/taptap/Wasteland Equipment Bureau/docs/phase-3/04-loot-inspection-and-research.md>)；此前：[布局调优、旧档兼容及完成验收](<D:/taptap/Wasteland Equipment Bureau/docs/phase-3/02-layout-tuning.md>)；此前：[本机存档、四把起手武器与难度审计](<D:/taptap/Wasteland Equipment Bureau/docs/phase-3/01-local-save-and-starters.md>)。前次 [总资料手册与耗材记录](<D:/taptap/Wasteland Equipment Bureau/docs/phase-2/06-manual-and-supplies.md>) 保留为阶段2历史。

- 5×6 背包；多格形状、旋转预览、拖动/点选放置、单物原子交换、逐步撤销、无限容量分页备存。放不下的装备不会被删除。
- 17 件自定义装备、四个邻接组合及两种直接联动；总资料手册可在菜单或局内浏览全部装备、配方图示、战斗规则与敌人。六页基础教程独立保留。
- 三种一次性物品：封装急救包、破甲封筒、应急泡沫罐。新增破甲/泡沫进入普通掉落池；自动触发后本波结束移除，未触发跨波保留。
- 电池加速保留定点计时余量：短刃0.7秒→平均0.63秒。铜线「错峰检修」让两把武器协同延后敌人出手，每波有限次数。
- 撤离时限、敌方下一击、减伤/护盾/生命分账、消耗品余量、攻击反馈和可暂停展开的最近战报。
- 1 名装备员、3 种普通敌人、1 个会转阶段的首领；100ms 固定步长自动战斗。
- 当前开发池四把武器均可作初始武器：钉线、折板、短刃、余热喷嘴；菜单按已解锁武器生成，不再写死三项。
- 初始武器选择 → 整备 → 战斗 → 三选一双物品补给 → 五波首领 → 胜负/主动放弃结算。
- 每波补给可“暂时收起 / 查看已有装备”，查看背包、备存、规则与手册后“返回领取物资”；Esc同样可切换。查看期间只读，不放弃、不重抽、不跳关；领取后再整理装备。
- 菜单“装备解锁”：全宽橙色入口显示金币和进度，用结算金币解锁铜线接驳器、余热喷嘴、旧式侦测盘、盐水滴瓶、封装急救包5张蓝图；研究与路线选择在本机存档保留，不直接赠送装备或加永久属性。
- 确定性种子、独立战斗/补给/事件随机流；基础金币和结算回执同次保存、幂等领取。
- 本机自动存档：工单、背包、掉落、战斗RNG／耗材次数、金币与教程已读；刷新恢复战斗先暂停，需手动继续。坏档／未来版本／冲突阻断并保留原数据。
- 暂停/明确恢复、弹窗防穿透、窄屏等比留白；代码绘制的原创界面与角色。

**默认保留自由试玩：17件装备和四把起手武器全开放。可在菜单切到研究路线：新工单使用基础12件、三把基础起手武器和已研究蓝图；余热喷嘴研究后增加第四把起手武器。研究不改变已有工单的掉落池／数值，旧工单继续原规则。金币可用于蓝图研究，无永久属性升级。** 没有每日挑战、商城或广告的占位按钮，音效继续后置。

## 给朋友试玩（Windows x64）

交付包：[Wasteland-Bureau-0.4.1-Win64.zip](<D:/taptap/Wasteland Equipment Bureau/dist/friends/20261026-083408-850685/Wasteland-Bureau-0.4.1-Win64.zip>)，35,990,691字节（约34.3 MiB）。已通过中文／空格目录解压启动及57项真实Chrome回归。

把整个ZIP发给朋友，**完整解压 → 双击“开始试玩.cmd”**；自带Node运行程序，不需要安装Cocos或npm。默认浏览器会打开本机4187端口；若默认浏览器不支持WebGL，请用Edge/Chrome打开启动窗口所示地址。试玩时保留启动窗口，结束按Ctrl+C。需要64位Windows，尚未验证朋友电脑或其他平台。

存档属于同一浏览器的本机站点数据；换浏览器、隐身模式或清除数据会丢失读取入口。金币可用于菜单装备解锁；默认自由试玩17件／4起手，研究路线逐项开放蓝图；不是正式TapTap原生包。详见[0.4.1交付与验收记录](<D:/taptap/Wasteland Equipment Bureau/docs/phase-3/05-equipment-unlock-and-pressure.md>)。

## 本机开发预览

在工作区 PowerShell 中运行：

~~~powershell
$env:BUILD_NAME='web-mobile-growth'
$env:PORT='4174'
python tools/run_tool.py node tools/serve_preview.cjs
~~~

新版本机地址：**http://127.0.0.1:4174**（运行后可访问；原4173保留旧版）。服务只监听回环地址，不对局域网开放。启动前应已有真实构建；没有时先运行下方构建命令。使用 Ctrl+C 停止预览服务。

操作：
1. 菜单右上角“资料手册”可直接浏览全目录，无需先开局。选择初始武器、领取工单；首次出现六页教程，可跳过，随时重看。
2. 把备存装备拖入格子，或先点装备再点空格。
3. 把武器与电池正交贴边（斜角不算），查看实际间隔变化；贴护板加伤。点“完整规则”看配方与生效对象。
4. 旋转按钮或 R 只改预览；落下/点原物品确认。Z 撤销，Esc 取消选择或关闭确认窗。
5. 至少放入一把武器才能开战；45秒内清场。点设备卡片或展开战报会暂停，关闭后原样继续。每波结束选择补给，再整理背包。

## 工程与验证

### 核心与交互控制器测试

~~~powershell
python tools/run_tool.py node tools/test_game.cjs
~~~

目前 **294/294** 通过，包含配置、RNG、背包、四个组合、战斗、五波状态机、补给/结算去重、暂停、总手册，以及三种一次性补给的触发、跨波保留与移除、存档故障注入／刷新恢复、完整金币回执和四武器起手。使用本机已安装引擎附带的 TypeScript 4.9.5 做严格编译，没有为了本阶段安装新版依赖。

### 附加开发工具测试

~~~powershell
python tools/run_tool.py npm run test:tools
python tools/run_tool.py npm run test:preparation
~~~

Node工具共20项（异步5、构建证据7、便携服务器8）；Python工具共23项（准备12、构建7、打包4）。这些独立于294项游戏／存档测试，不作为引擎构建、浏览器或真机通过的替代；Windows 若拦截测试子进程，应完成审批后重试，不应把权限错误算作通过。

### Cocos 声明检查与真实构建

~~~powershell
python tools/run_tool.py node tools/check_cocos.cjs
python tools/build_game.py --output-name web-mobile-friends --timeout 600
~~~

构建工具先真实导入，读取 Creator 生成的脚本元数据及编译注册 ID，再挂到用户真实保存的场景副本；随后做开发构建，记录源码稳定性和文件哈希。不会伪造引擎元数据来冒充成功，也不会安装 TapTap 插件、填造 AppID 或上传审核。

### 真实浏览器回归

~~~powershell
python tools/run_tool.py node tools/verify_game.cjs
~~~

启动本机 Chrome 无头模式，通过真实 Cocos 画布上的鼠标/键盘输入游玩。测试没有替换引擎，没有修改伤害/生命，也没有以跳帧结算代替实际五波运行。日志、失败记录与截图保存在工作区日志目录。

### 难度策略审计（不是玩家胜率）

~~~powershell
python tools/run_tool.py npm run analyze:balance
~~~

126条当前数值的确定性模拟，比较普通池／开发池、起手武器和三种装备／补给策略；没有发装备、改敌人或改玩家数值。前三起手在“拿第一组补给、首个合法空位摆放”下两池均6／6通关，说明难度偏低不只因全开放；具体记录、推断与样本局限见阶段3文档。这是旧版基线，不能当作新版结果。新版另用 `npm run analyze:layout` 比较旧版／调优版、两池、同工单与逐波严格配对，见阶段3调优文档。

## 关键位置

| 入口 | 内容 |
|---|---|
| [0.4.1装备解锁与后期难度](<D:/taptap/Wasteland Equipment Bureau/docs/phase-3/05-equipment-unlock-and-pressure.md>) | 醒目入口、后期压力、326项测试、57项浏览器回归与独立试玩包 |
| [0.4.0补给与研究验收](<D:/taptap/Wasteland Equipment Bureau/docs/phase-3/04-loot-inspection-and-research.md>) | 收起／返回、蓝图路线、309项测试与新版试玩包 |
| [阶段 2 实现说明](<D:/taptap/Wasteland Equipment Bureau/docs/phase-2/01-core-loop.md>) | 代码结构、规则、模式和复现方法 |
| [资料手册与一次性补给](<D:/taptap/Wasteland Equipment Bureau/docs/phase-2/06-manual-and-supplies.md>) | 17件目录、3种一次性物品、225项测试与本轮构建/浏览器证据 |
| [玩法设计评审](<D:/taptap/Wasteland Equipment Bureau/docs/phase-2/07-gameplay-review.md>) | 策略风险、人工验证假设与后续优化优先级，不冒充平衡实测 |
| [前次人工试玩整改](<D:/taptap/Wasteland Equipment Bureau/docs/phase-2/05-playtest-feedback.md>) | 0.2.1历史记录：电池、教程、战报与时序机制 |
| [阶段 2 实测记录](<D:/taptap/Wasteland Equipment Bureau/docs/phase-2/02-verification.md>) | 真实结果、缺陷修复、构建/截图证据和未测项 |
| [下一阶段工作](<D:/taptap/Wasteland Equipment Bureau/docs/phase-2/03-next-stage.md>) | 存档、成长、教程/音效、每日挑战；广告后置 |
| [素材与许可台账](<D:/taptap/Wasteland Equipment Bureau/docs/phase-2/04-assets-and-licenses.md>) | 原创代码绘图、系统字体及开发工具边界 |
| [Cocos 场景](<D:/taptap/Wasteland Equipment Bureau/game/assets/Smoke.scene>) | 已实际挂载 BureauRoot 的真实场景副本 |
| [核心代码](<D:/taptap/Wasteland Equipment Bureau/game/assets/scripts/core>) | 不依赖 cc、平台 SDK、DOM 或真实时间 |
| [测试](<D:/taptap/Wasteland Equipment Bureau/game/tests>) | Node 内置测试，实际结果见日志 |

Creator 中选择 **打开现有项目**，定位 D:/taptap/Wasteland Equipment Bureau/game，版本为 3.8.8；打开 assets/Smoke.scene 即是游戏入口。无需重新建立空场景或手工补脚本。编辑器 GUI 内的人工试玩/重新打开尚需用户复核，本轮自动验证采用真实 CLI 构建和构建产物运行。

## 仍未完成的边界

- **阶段3已完成一部分**：本机存档／中断恢复、未来版本和冲突阻断、金币／回执一致性、四武器入口、补给只读查看、金币消费及5张永久蓝图研究。仍未完成通用旧schema迁移、界面诊断导出／确认重建、图鉴收集、永久属性升级、成就、每日挑战、交互式教程与音效。蓝图“永久”仅指同一浏览器站点本机存档，不是云账号资产。
- **玩法与难度**：仍为原五波循环；风险路线、精英词缀等尚未实现。已实现新工单散装火力／角铁收益调优和旧工单版本保留；0.4.1仅增强第四波敌人及首领生命，前三波、装备值和旧工单不变。326项游戏测试、57项工作区及解压浏览器回归通过；仍需真人研究路线／布局反馈，不能将实验结果当玩家胜率。
- **阶段 4**：独立广告服务、可控模拟广告、所有异常回调和可信完播发奖；真实 Dirichlet 适配仍需核实配置与账号条件。
- **阶段 5–6**：TapTap 插件转换与原生包、真实登录、设备/前后台/广告测试、包体门禁、隐私与发布准备。
- 当前 Web 调试包体积不代表 TapTap 首包大小；浏览器成功不代表安卓/iOS/TapTap 真机通过。
- 无提交、无推送、无审核上传或发布。原 verification/EngineSmoke 没有被修改。

## 阶段 1 历史基线

阶段 1 文档保留当时的事实、方案与 NOT_RUN 状态，**不是当前进度面板**。最新状态以阶段3的0.4.1装备解锁与难度验收记录为准。旧阶段 1 校验器在 2026-10-15 的保留运行是 15 项通过 / 1 项失败：它要求玩法工程尚不存在，与当前阶段冲突。该失败保留且已注明，不作为阶段 2 验收入口。

- [环境与安装](<D:/taptap/Wasteland Equipment Bureau/docs/phase-1/01-environment.md>)
- [平台官方核查与发布风险](<D:/taptap/Wasteland Equipment Bureau/docs/phase-1/02-platform-verification.md>)
- [原始玩法方案](<D:/taptap/Wasteland Equipment Bureau/docs/phase-1/03-mvp-design.md>)
- [架构与持久化方案](<D:/taptap/Wasteland Equipment Bureau/docs/phase-1/04-architecture.md>)
- [六阶段路线与验收矩阵](<D:/taptap/Wasteland Equipment Bureau/docs/phase-1/05-roadmap-and-tests.md>)
- [广告设计](<D:/taptap/Wasteland Equipment Bureau/docs/phase-1/06-ad-design.md>)
- [配置与发布门禁](<D:/taptap/Wasteland Equipment Bureau/docs/phase-1/07-setup-and-release-gates.md>)
