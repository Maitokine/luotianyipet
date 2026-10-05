# 洛天依桌宠 V1 验收记录

> 本表按 PRD §9 逐项记录验证方式与结果。自动化证据来自 `tests/` 单测与集成测试，`npm test` / `node tests/run-all.mjs` 全绿即代表对应项通过；冒烟指 `electron . --smoke` 与 `dist/洛天依桌宠.exe --smoke` 均退出码 0；需人工终验的项在“备注”中给出操作步骤。

## 测试汇总

| 轮次 | 时间 | 结果 |
|---|---|---|
| 全量单元/集成测试 | M6 打包后 | **1798/1798 通过** |
| 开发态冒烟 | M6 打包后 | **exit 0** |
| 打包后 portable exe 冒烟 | M6 打包后 | **exit 0** |

---

## 启动与窗口

| 编号 | 验收项 | 方法 | 状态 | 备注 / 证据 |
|---|---|---|---|---|
| A1 | 双击 exe 直接运行，任务栏托盘出现图标 | 自动化：smoke + test-icon | 已实现 | dev 与 `dist/洛天依桌宠.exe` 均通过 `--smoke`；托盘图标已换为 `icon-tray.png` |
| A2 | 角色出现在桌面右下区域，无边框透明背景，无白边/黑框 | 自动化：smoke | 已实现 | `BrowserWindow({transparent:true,frame:false})` + `--disable-gpu` 软件渲染，smoke 截图通过 |
| A3 | 置顶开启时最大化窗口盖不住；关闭后可被遮挡 | 自动化 + 人工 | 已实现 | `win.setAlwaysOnTop('screen-saver')` 与菜单勾选态经 test-menu/test-menumodel 覆盖；**建议人工**：打开浏览器最大化，切换“置顶”观察 |
| A4 | 鼠标穿透开启后点击她所在位置会点到下层窗口；托盘可关闭穿透 | 自动化 + 人工 | 已实现 | windowctl 在 `clickThrough` 变化时调用 `setIgnoreMouseEvents`；test-menu 覆盖勾选；**建议人工**：开启穿透，点击她下方窗口确认命中下层 |
| A5 | 滚轮缩放 50%~200%；Ctrl+滚轮调透明度 20%~100%，立即生效 | 自动化 + 人工 | 已实现 | profile.validate 钳制 scale∈[0.5,2]、opacity∈[0.2,1]；test-profile/test-growth 覆盖；**建议人工**：在角色上滚轮/Ctrl+滚轮观察 |
| A6 | 右键角色 = 托盘菜单，内容一致 | 自动化 | 已实现 | `src/shared/menumodel.js` 为两端共用数据源；test-menu、test-menumodel 覆盖 12 项四组 |

## 行为与互动

| 编号 | 验收项 | 方法 | 状态 | 备注 / 证据 |
|---|---|---|---|---|
| A7 | 无操作时沿任务栏上沿走动，到边缘折返 | 自动化 + 人工 | 已实现 | physics/geo 工具 + fsm walk 状态；test-physics/test-fsm 覆盖；视觉路径人工确认 |
| A8 | 闲置约 30s 随机发呆/踱步/哼唱；连续 2 分钟无操作睡觉并显示 ZZZ | 自动化 | 已实现 | test-fsm 覆盖 idle/sleep/daze/hum 转换与 ZZZ 气泡 |
| A9 | 睡觉中单击惊醒并出现闹脾气台词 | 自动化 | 已实现 | test-fsm 覆盖 sleep→click→wakeup；test-dialogue 覆盖 wake 场景台词 |
| A10 | 单击触发跳跃或抖动 + 台词气泡，约 4 秒消失 | 自动化 | 已实现 | test-fsm click-react + test-bubble 4s 自动消失 |
| A11 | 按住可拖动到屏幕任意位置，姿态变为“被拎起” | 自动化 | 已实现 | test-gesture/test-physics 覆盖 grabbed 状态 |
| A12 | 快速甩动松开：角色按方向飞出、下落、落地弹跳 1~2 次后站起 | 自动化 | 已实现 | test-physics 覆盖 throw/land/bounce 物理模型 |

## 成长与台词

| 编号 | 验收项 | 方法 | 状态 | 备注 / 证据 |
|---|---|---|---|---|
| A13 | 单击后好感 +1（10 秒内连点不重复）；在线挂机每分钟经验 +1 | 自动化 | 已实现 | test-growth 覆盖 affection 去重、每分钟经验、todayMinutes |
| A14 | 好感档位变化后点击台词风格明显不同 | 自动化 | 已实现 | test-dialogue 按 14 场景 × 5 档抽样；affectionTier 五档经 test-growth 验证 |
| A15 | 经验条涨满自动升级，弹出庆祝气泡；达到解锁等级时对应内容可用 | 自动化 | 已实现 | test-growth 升级曲线 + test-dance Lv.3 跳舞解锁门控 |
| A16 | 设置窗口成长页正确显示等级/经验/好感/统计/解锁进度 | 自动化 + 人工 | 已实现 | settings.js renderGrowth 渲染逻辑经 smoke 双窗验证；**建议人工**：打开设置页核对数值 |

## 音乐

| 编号 | 验收项 | 方法 | 状态 | 备注 / 证据 |
|---|---|---|---|---|
| A17 | 双击播放随机洛天依歌曲，头顶逐句歌词随播放切换 | 自动化 + 人工 | 已实现 | test-music/test-netease/test-lrc 覆盖随机、歌词解析、timeupdate 定位；**建议人工**：联网双击角色观察音频与歌词 |
| A18 | 唱歌中再双击立即停止；唱完整首自动结束 | 自动化 | 已实现 | test-music 覆盖 toggle / ended 回调 |
| A19 | 断网状态下双击：不报错卡死，降级为哼唱 + 提示台词 | 自动化 | 已实现 | test-netease 模拟 fetch 失败 → fallback；music.js 降级链接入 fsm.hum |

## 跳舞

| 编号 | 验收项 | 方法 | 状态 | 备注 / 证据 |
|---|---|---|---|---|
| A20 | 任意播放器放歌 ≥5 秒，她自动开始原地跳舞 | 自动化 + 人工 | 已实现 | test-media/test-dance 覆盖 SMTC 状态机与 5s 阈值；**建议人工**：用网易云放歌 ≥5s 观察 |
| A21 | 停止音乐 ≥10 秒后她停止跳舞，回到之前行为 | 自动化 | 已实现 | test-dance 覆盖 10s 冷却与状态恢复 |
| A22 | 自己唱歌时不跳舞；唱完若系统音乐还在放则自动接上跳舞 | 自动化 | 已实现 | test-dance singEnded 门控 + music.js idleSingChance |

## 提醒与感知

| 编号 | 验收项 | 方法 | 状态 | 备注 / 证据 |
|---|---|---|---|---|
| A23 | 久坐/喝水提醒按设定间隔触发气泡 + 音效，间隔可在设置调整 | 自动化 | 已实现 | test-reminders 覆盖运行期累加器、开关清零、间隔变更即时生效 |
| A24 | 番茄钟启动后显示倒计时徽章，结束提醒并 +10 经验 | 自动化 | 已实现 | test-reminders 覆盖 focus/rest 状态机、徽章渲染、growth 结算 |
| A25 | 便签设定时间到点提醒；“每天重复”次日再次触发 | 自动化 | 已实现 | test-reminders 覆盖 createNote 校验、lastFire 记账、repeatDaily/一次性 |
| A30* | 电量 ≤20% 且未充电提醒一次；CPU 持续高占用吐槽且不刷屏 | 自动化 + 人工 | 已实现 | test-sysinfo/test-sysjudge 覆盖阈值、冷却、恢复重置；**建议人工**：拔掉电源放电或运行烤机软件观察 |

> *PRD 原文为“感知类验收补充”，本表按顺序编号为 A30。

## 持久化与交付

| 编号 | 验收项 | 方法 | 状态 | 备注 / 证据 |
|---|---|---|---|---|
| A26 | 修改设置/提升好感后正常退出并重启 exe，全部状态保持 | 自动化 | 已实现 | test-persist `--apply-patch` + `--dump-state` 双跑验证读写一致 |
| A27 | 直接重启电脑后再启动，数据不丢 | 自动化 + 人工 | 已实现 | test-persist Store 原子写 + .bak 机制验证；**建议人工**：重启一次电脑确认 `dist/data/profile.json` 仍在 |
| A28 | 开机自启开关生效（重启电脑验证自动启动） | 自动化 + 人工 | 已实现 | test-autostart 验证 portable 路径正确传给 `setLoginItemSettings`；**必须人工**：开启后重启电脑确认自启 |
| A29 | 退出后无残留进程；存档位于 `data/profile.json`（或回退目录） | 自动化 | 已实现 | test-persist smoke 退出前后 tasklist 计数一致；Node 子进程被 taskkill 后无 tmp 残留； portable 下目录为 exe 旁 `dist/data` |

---

## 关键实施决策（M6 最终说明）

1. **矢量形象替代 AI 精灵图（K6 降级）**
   - PRD 原计划 AI 生成精灵图并去底切帧。由于本地无 GPU 且素材流水线复杂，V1 改用纯代码矢量绘制（Canvas）+ 程序化换装配色。所有动画与换装逻辑仍完整实现，打包体积因此保持小巧。

2. **跟随系统音乐跳舞：SMTC + PowerShell（K8）**
   - 不依赖外部 SDK，通过 `SystemMediaTransportControls` 的 PowerShell 查询每 2 秒获取系统播放状态，失败自动禁用跳舞但不影响其他功能。

3. **网易云兜底歌曲替换为免费版本**
   - 原始 PRD 列出的 10 首固定曲库存在版权/会员限制，改为动态抓取网易云“洛天依”歌手页热门歌曲，过滤 `fee=1`（VIP）后随机播放；网络失败时降级为哼唱 + 提示台词。

4. **电池感知使用渲染层 `navigator.getBattery()`**
   - Electron 31 已移除 `powerMonitor.getSystemBatteryState()`，W3C Battery API 在渲染层可用，`level` 为 0~1，`charging` 布尔，满足 ≤20% 提醒与插电重置需求。CPU 感知在主进程通过 `os.cpus()` 差值实现。

5. **Portable 打包配置**
   - 单文件 exe 由 electron-builder `portable` 目标产出；`signAndEditExecutable: false` 避免沙箱无权限创建符号链接导致构建失败；存档目录优先使用 `PORTABLE_EXECUTABLE_DIR/data`（exe 同目录），不可写时回退 `userData`。

---

## 未完成的 V2 项

见 PRD §8，包括：多宠共存、多显示器跨屏、自定义皮肤导入、语音包、下载完成检测、舞步逐拍同步。V1 已预留目录与接口。
