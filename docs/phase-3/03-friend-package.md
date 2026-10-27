# Windows x64 朋友试玩交付

> 本文保留0.3.0历史交付证据。0.4.0最新交付见 [补给收起与蓝图研究验收](<D:/taptap/Wasteland Equipment Bureau/docs/phase-3/04-loot-inspection-and-research.md>)。

日期：2026-10-21；配置 mvp-0.3.0-dev-all。Web Mobile本机试玩，不是TapTap原生包。

## 交付文件

- [ZIP](<D:/taptap/Wasteland Equipment Bureau/dist/friends/20261021-162842-759712/Wasteland-Bureau-0.3.0-Win64.zip>)：35,985,803字节（34.3 MiB），解压99,598,202字节／37文件。
- [SHA256校验文件](<D:/taptap/Wasteland Equipment Bureau/dist/friends/20261021-162842-759712/Wasteland-Bureau-0.3.0-Win64.zip.sha256.txt>)。
- SHA256：`d208561a5f29eee5cd8355f45b439a93d9374b781f79fb6c08ef17e972d55719`。

发送整个ZIP。完整解压，双击“开始试玩.cmd”（或ASCII名称Start.cmd）。使用64位Windows和支持WebGL的Edge／Chrome；启动窗口需保持打开，关闭前按Ctrl+C。已自带Node 24.21.0，无npm／Cocos安装要求。本机地址固定127.0.0.1:4187；启动自动校验完整文件集合与逐文件SHA，避免损坏包被误判为游戏缺陷。校验仅检测完整性，不提供代码签名或可信来源保证，需确认ZIP来源。

## 数据与边界

- 仅回环静态服务器；仅GET／HEAD、封锁越界路径／符号链接越界／错误Host，不暴露runtime、许可证、源代码或工作区。
- 无管理员需求、任意进程终止、静默换端口或局域网开放；端口冲突只接受相同包标识，否则明确报错。
- 存档位于同一浏览器同一来源localStorage；不同浏览器／隐身模式／清除站点数据会影响恢复。默认端口不迁移原4173用户存档；旧档兼容以独立测试夹具演练，不意味着用户数据迁移。
- 开放17件／4起手，金币仅累积，暂无音效、商城、广告或成长购买系统。
- 包内仅构建、启动脚本、内置运行程序、说明及上游通知，无个人配置、日志、用户存档、编辑器、Chrome或npm。

## 已完成验证

1. 294项游戏／控制器／存档测试默认子进程隔离通过；严格TS与Cocos声明检查通过。
2. Creator裁剪后独立构建，27输入文件SHA与19构建文件SHA稳定，5,829,146字节。
3. 裁剪构建33项真实Chrome输入／刷新／旧档回归通过，83截图。
4. ZIP CRC与SHA、37解压文件集合／逐文件SHA，带中文及空格目录启动随包CMD与内置Node；19 HTTP资源与HEAD验证。
5. 解压版固定端口服务器上再次33项真实Chrome完整回归通过，83截图：正常五波金币32、四起手、窄屏、暂停恢复、自然补给及5种真实旧规则档。
6. Node工具20/20、Python工具23/23通过。沙箱子进程EPERM经批准重试，不计为通过。
7. 查看解压版320px菜单及通关结算截图；小屏字体与真人触控仍需人工手机试玩。

[完整交付审计](<D:/taptap/Wasteland Equipment Bureau/logs/phase-3/friend-package/latest.json>)；[实际解压启动](<D:/taptap/Wasteland Equipment Bureau/logs/phase-3/friend-package/launch-result.json>)；[解压版Chrome报告](<D:/taptap/Wasteland Equipment Bureau/logs/phase-2/browser-game-2026-10-21T08-35-10-650Z/result.json>)。

测试不使用用户浏览器存储，仅关闭本次启动的进程树。此前4173预览未停止。尚未测朋友实际设备、不支持声称macOS／手机可运行；无TapTap／APK打包、商店上传、远端提交或公开发布。

## 复现（需本机开发工具链）

~~~powershell
python tools/build_game.py --output-name web-mobile-friends
python tools/run_tool.py node tools/verify_game.cjs
python tools/package_friends.py
python tools/verify_friends.py
python -m unittest discover -s tools/tests -p 'test_*.py' -v
~~~

朋友无需执行这些开发命令。生成脚本拒绝过期构建／编译证据、不同构建的浏览器报告以及未裁剪运行库；实际ZIP启动测试独立记录，未启动验收时不会标成已通过。启动测试用--no-open抑制打开用户默认浏览器，真实Chrome使用隔离上下文访问同一服务。
