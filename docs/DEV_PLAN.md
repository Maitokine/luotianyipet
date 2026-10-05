# 洛天依桌面宠物 · 开发计划（DEV_PLAN）

| 项 | 内容 |
|---|---|
| 依据 | PRD.md V1.0（唯一需求来源） |
| 原则 | 每个里程碑结束都是**可运行版本**；每个任务有明确产出文件与验收项（A 编号对应 PRD §9） |
| 技术栈 | Electron（主进程 Node.js + 渲染层原生 HTML/CSS/JS，不引入前端框架）+ AI 生成精灵图 + Python 辅助脚本（素材处理、音效合成） |

---

## 一、总览与执行顺序

```
M0 骨架 ──▶ M1 形象与窗口 ──▶ M2 行为与互动 ──┬─▶ M3 成长与台词 ──┬─▶ M5 工具/菜单/设置 ──▶ M6 打包与总验收
（空壳可跑）  （看得见的她）     （活起来的她）    └─▶ M4 音乐点歌 ────┘
```
- M3 与 M4 互不依赖，可任意先后（计划按 M3 → M4 执行）
- 每个任务标注依赖；无依赖标注的任务可并行

---

## 二、项目目录结构（一次性建好）

```
E:\luotianyipet\
├── PRD.md / docs\{DESIGN.md, DEV_PLAN.md}
├── package.json
├── build\                          打包资源（图标、builder 配置）
├── scripts\                        Python 辅助脚本
│   ├── gen_assets.py               素材流水线：去白底→切帧→清单生成
│   └── gen_sfx.py                  音效合成（8-bit 风格短音效）
├── src\
│   ├── main\                       Electron 主进程
│   │   ├── main.js                 入口：窗口、生命周期、二次启动去重
│   │   ├── tray.js                 托盘图标 + 原生菜单骨架（保底）
│   │   ├── ipc.js                  全部 IPC 通道注册表
│   │   ├── store.js                存档：读写/防抖/定时/备份/损坏恢复
│   │   ├── netease.js              网易云请求代理（无 CORS 限制）
│   │   ├── media.js                SMTC 系统媒体监听（可失败，失败上报）
│   │   └── sysinfo.js              CPU 采样 + 电源状态
│   ├── preload.js                  contextBridge 白名单 API
│   ├── renderer\
│   │   ├── index.html              桌宠窗口
│   │   ├── settings.html           设置窗口
│   │   ├── css\{pet.css, settings.css, menu.css}
│   │   └── js\
│   │       ├── pet.js              渲染层入口，装配各模块
│   │       ├── fsm.js              行为状态机（核心）
│   │       ├── animation.js        帧动画引擎
│   │       ├── interact.js         手势系统（单击/双击/拖/甩）
│   │       ├── physics.js          抛出物理模拟
│   │       ├── bubble.js           气泡/歌词条/徽章 UI
│   │       ├── menu.js             HTML 右键菜单（角色+托盘共用数据源）
│   │       ├── growth.js           等级/经验/好感/解锁
│   │       ├── dialogue.js         台词库加载与抽取
│   │       ├── music.js            播放控制 + LRC 解析
│   │       ├── dance.js            跳舞判定（消费 SMTC 事件）
│   │       ├── reminders.js        提醒四件套
│   │       └── outfit.js           换装
│   └── assets\
│       ├── sprites\{default,spring,star}\   三套服装精灵图
│       ├── sfx\                    音效（jump/land/happy/alert/pomo_end…）
│       └── voices\                 预留空目录 + README（V2 语音包）
└── data\                           运行时存档（profile.json、profile.bak）
```

---

## 三、关键技术决策（实现方案钉死，开发时不再讨论）

### K1 悬浮窗与"动态鼠标穿透"（A2/A4 核心）
- 窗口：`transparent:true, frame:false, alwaysOnTop:true, skipTaskbar:true, hasShadow:false`，尺寸 **300×420**（底部 180px 角色区 + 上方 240px 气泡/歌词/徽章区）
- 置顶层级 `win.setAlwaysOnTop(true, 'screen-saver')`，菜单切换
- **透明区域永远穿透**（否则 300×420 的隐形框挡住下面窗口）：默认 `setIgnoreMouseEvents(true, {forward:true})`；渲染层监听 `mousemove`，用**离屏 Canvas 像素检测**（预渲染当前帧的 alpha 图，鼠标坐标查 alpha>0 即命中）动态切换为可交互
- PRD 的"鼠标穿透开关"= 全局强制穿透（连角色身体也穿透），开启时忽略命中检测

### K2 行走地面与窗口定位（A7）
- 地面 = `screen.getPrimaryDisplay().workArea` 底边（自动避开任务栏）
- 角色在窗口内横向移动；每帧 `win.setPosition(Math.round(x), groundY)` 窗口跟随；左右界 = workArea 左右边缘，触边折返
- 屏幕分辨率变化监听 `screen.on('display-metrics-changed')` 重算地面

### K3 手势系统（A10~A12、A17/A18）
统一手势状态机（`interact.js`），规则：
- mousedown 启动采样；**位移 <6px 且 <400ms** 记为点击候选 → **250ms 内无第二击 = 单击**（触发摸摸）；第二击 = 双击（触发点歌/停止）
- **位移 ≥6px** 进入拖拽（进入"被拎起"）；持续记录最近 80ms 速度向量
- mouseup 时速度 >0.35px/ms 判定为甩出 → 抛出；否则原地放下
- 拖拽期间 `document.body` 加 `-webkit-app-region: no-drag` 控制，窗口移动用 `win.setPosition`（不用系统拖动，保证可控）

### K4 抛出物理（A12）
`physics.js` rAF 循环：初速 = 甩出速度（限幅 2.2px/ms）×方向；每帧 `vy += g`（g=0.5px/frame²）；落地（y≥ground）反弹 `vy *= -0.45`，|vy|<1.2 结束进入落地弹跳动画（1~2 次小幅 squish）→ 恢复站立；左右屏幕边缘 `vx *= -0.6` 反弹；飞行中播放"飞行/惊叫"姿态

### K5 状态机（fsm.js，全项目中枢）
- 状态注册表：`{name, enter(), exit(), tick(dt), interruptible}`；两栈设计：**日常栈**（闲逛/发呆/踱步/睡觉/哼唱）与**打断队列**（单击互动/唱歌/跳舞/物理/提醒）
- 打断进入时快照日常状态；打断结束弹栈恢复（PRD"记得回去做刚才的事"）
- 唱歌与跳舞互斥：唱歌优先级高；唱完检查 SMTC 仍播放 → 自动转跳舞（A22）

### K6 素材流水线（scripts/gen_assets.py）
1. **生成**：AI 生成"单动作帧网格图"（1×4 或 2×3 帧，纯白背景，统一人设提示词）
2. **去底**：PIL 阈值去白 + alpha 边缘收缩 1px（消白边）
3. **切帧**：按网格均分切单帧 PNG（256×256），输出 `assets/sprites/<服装>/<动作>_<帧号>.png`
4. **清单**：生成 `manifest.json`（动作名→帧列表→帧率→循环/单次）
- **降级策略**：若某动作多帧质量不合格（闪烁/不连贯），改用"单帧 + CSS transform 动画"（上下弹跳/左右摆动/缩放脉冲）保底，功能验收不受影响

**动作与帧数规格表**（默认装全量；春日裙/星海礼服先做核心集：站立/走路/发呆/睡觉/唱歌/跳舞/开心，其余动作 V1 复用默认装）：

| 动作 | 帧 | 循环 | 说明 |
|---|---|---|---|
| idle 站立 | 2 | ✓ | 呼吸微动 |
| walk 走路 | 4 | ✓ | 需左右镜像 |
| daze 发呆 | 3 | 单次 | 眨眼放空 |
| pace 踱步 | 复用 walk | ✓ | 小幅往返 |
| sleep 睡觉 | 2 | ✓ | +CSS ZZZ 气泡 |
| hum 哼唱 | 3 | ✓ | +音符粒子 |
| sing 唱歌 | 4 | ✓ | 拿麦克风 |
| dance1/2/3 跳舞 | 各 4 | ✓ | 三套轮换 |
| jump 跳跃 | 4 | 单次 | 抛物线位移配合 |
| shake 抖动 | 2 | 单次 | 横向高频 |
| grabbed 被抓 | 1 | - | 悬空姿态 |
| fly 被抛飞行 | 2 | ✓ | 旋转由 CSS |
| land 落地弹跳 | 3 | 单次 | squish 压扁 |
| wake 惊醒 | 2 | 单次 | 睡觉专用 |
| happy 开心 | 3 | 单次 | 好感事件 |
| angry 生气 | 2 | 单次 | 低好感/被抛 |

### K7 网易云接口（netease.js，主进程 `net.fetch`，带浏览器 UA）
| 用途 | 接口 | 备注 |
|---|---|---|
| 找歌手 ID | `GET /api/search/get?s=洛天依&type=100` | 结果缓存至存档 |
| 热门歌曲 | `GET /api/artist/{id}` | 取 hotSongs（约50首），**fee∈{0,8} 视为可播**，列表缓存 24h |
| 歌词 | `GET /api/song/lyric?id={id}&lv=1&kv=1&tv=-1` | lrc 字段 |
| 音频 | `https://music.163.com/song/media/outer/url?id={id}.mp3` | 302 至 CDN；Renderer `<audio>` 直接播 |
- 降级链（PRD §5.7）：歌手页失败 → 内置 5 首 ID 兜底（开发期先手工核对这 5 首的 ID 与可播性）→ 全失败 → 哼唱 + 台词
- 所有请求 8 秒超时；失败重试 1 次

### K8 SMTC 跳舞（media.js + dance.js）
- 首选原生模块 `node-nowplaying`（`require` 包 try/catch）：`electron-rebuild` 编译；**加载失败 → IPC 通知渲染层 `danceUnavailable`，设置页显示"不可用"**，其余功能零影响
- `dance.js` 判定：`外部会话播放中 && 播放持续≥5s && 功能开 && 状态机允许` → 请求打断进入跳舞；`停止≥10s` → 请求退出
- 自身播放过滤：Electron 不注册 mediaSession 元数据，SMTC 一般不出现自身会话；仍出现则按会话来源过滤

### K9 存档（store.js，A26/A27/A29）
- 路径：`process.env.PORTABLE_EXECUTABLE_DIR`（打包后）→ exe 旁 `data/profile.json`；不可写回退 `app.getPath('userData')`
- 写入策略：防抖 2s + 每 5 分钟 + `before-quit`；每次写入前 `profile.json → profile.bak`
- 启动时：主档损坏 → 用 .bak 恢复并气泡告知"档案刚才吓了一跳，已经找回来了"
- 字段 = PRD §5.14 + 歌手 ID 缓存 + 好感今日计数/衰减日期 + 便签列表

### K10 打包（M6）
- electron-builder `win portable` 单 exe；`asarUnpack` 精灵图与原生模块；图标 256px PNG 转ico
- **注意**：portable exe 运行时解压到临时目录，"exe 同目录"必须用 `PORTABLE_EXECUTABLE_DIR` 环境变量（K9 已含）
- 开机自启用 `app.setLoginItemSettings({openAtLogin})`；提示：移动 exe 位置后需重新开启自启

---

## 四、任务分解

### M0 项目骨架（产出：空壳可运行）
| # | 任务 | 产出 | 验收 | 依赖 |
|---|---|---|---|---|
| T0.1 | 初始化 npm 项目、装 Electron、建全目录 | package.json、目录树 | `npm start` 出空白透明窗 | - |
| T0.2 | 主进程入口：窗口参数（K1）、托盘图标+退出、单实例锁 | main.js、tray.js | A1（脚手架态） | T0.1 |
| T0.3 | preload + IPC 注册表骨架 + 存档模块（K9 完整实现，先带默认值） | preload.js、ipc.js、store.js | 改存档重启后保留 | T0.1 |
| T0.4 | 渲染层入口装配 + 占位角色图显示 | index.html、pet.js | 桌面显示占位图 | T0.2 |

### M1 形象与窗口（产出：看得见、可调的她）
| # | 任务 | 产出 | 验收 | 依赖 |
|---|---|---|---|---|
| T1.1 | 素材流水线脚本（去底/切帧/manifest） | gen_assets.py | 喂测试图输出正确帧 | - |
| T1.2 | 默认装全部动作素材生成与处理（K6 规格表，16 动作） | sprites/default/、manifest.json | 每动作帧可用 | T1.1 |
| T1.3 | 帧动画引擎：按 manifest 播放、循环/单次、完成回调、左右镜像 | animation.js | 手动切动作正常 | T1.2 |
| T1.4 | 动态穿透（K1 像素命中）+ 置顶开关 + 滚轮缩放/Ctrl 透明度 | pet.js 内集成 | **A3、A4、A5** | T0.4、T1.3 |
| T1.5 | 行走地面与窗口跟随（K2） | physics 内 geo 工具 | 手动移动测试贴地 | T0.4 |

### M2 行为与互动（产出：活起来的她）
| # | 任务 | 产出 | 验收 | 依赖 |
|---|---|---|---|---|
| T2.1 | 状态机核心：状态注册、打断队列、快照恢复 | fsm.js | 单测脚本通过 | - |
| T2.2 | 日常循环：闲逛行走、闲置 30s 随机（发呆/踱步/哼唱）、2 分钟睡觉+ZZZ、单击惊醒 | fsm 状态集 | **A7、A8、A9** | T2.1、T1.3 |
| T2.3 | 手势系统（K3 全规则） | interact.js | 单击/双击/拖/甩互不误触 | T1.4 |
| T2.4 | 抛出物理（K4）+ 被抓/飞行/落地动画接入 | physics.js | **A11、A12** | T2.3、T1.2 |
| T2.5 | 气泡 UI 基础（台词气泡 4s 自动消失、样式三件套） | bubble.js | **A10（动作部分）** | T0.4 |
| T2.6 | SMTC 集成 + 跳舞判定（K8）+ 舞蹈动画轮换 | media.js、dance.js | **A20、A21、A22（不含唱完衔接，M4 后联测）** | T2.1、T1.2 |

### M3 成长与台词（产出：养成的她）
| # | 任务 | 产出 | 验收 | 依赖 |
|---|---|---|---|---|
| T3.1 | 成长数值引擎：经验来源五类、升级曲线、解锁表、好感五档/日上限 30/48h 衰减 | growth.js | **A13**、数值单测 | T0.3 |
| T3.2 | 台词库：14 场景 × 5 档全量编写 + 抽取器（短期不重复） | dialogue.js、台词 JSON | **A14** | T2.5 |
| T3.3 | 升级庆祝流程 + 解锁提示气泡 + 成长事件接入（点击/听歌/番茄钟） | fsm+growth 联动 | **A15** | T3.1、T3.2 |
| T3.4 | 换装模块 + 春日裙/星海礼服核心集素材 + 锁定逻辑 | outfit.js、sprites/spring、star | 换装即时生效 | T1.2、T3.1 |

### M4 音乐（产出：会唱歌的她）
| # | 任务 | 产出 | 验收 | 依赖 |
|---|---|---|---|---|
| T4.1 | 网易云代理：歌手解析/热门列表/fee 过滤/24h 缓存/超时重试 | netease.js | 列表返回非 VIP 曲 | T0.3 |
| T4.2 | 播放控制：随机选歌、播放/停止、≥60% 结算、与 FSM 互斥（唱歌态） | music.js | **A17（播放）、A18** | T4.1、T2.1 |
| T4.3 | 歌词：LRC 获取解析、timeupdate 二分定位、逐句高亮、音符特效 | bubble 扩展 | **A17（歌词）** | T4.2 |
| T4.4 | 降级链：兜底 5 首（先手工核对 ID）→ 哼唱 + 提示台词；唱完接跳舞联测 | music.js 降级分支 | **A19、A22 联测** | T4.2、T2.6 |

### M5 工具、菜单与设置（产出：功能完整的她）
| # | 任务 | 产出 | 验收 | 依赖 |
|---|---|---|---|---|
| T5.1 | 提醒四件套：久坐/喝水/番茄钟（徽章倒计时）/便签（每天重复），全部走打断态+存档 | reminders.js | **A23、A24、A25** | T2.1、T2.5 |
| T5.2 | 系统感知：Battery API（≤20% 且未充电提醒一次，插电重置）+ CPU 采样（>85% 持续 30s，10 分钟冷却） | sysinfo.js + 事件台词 | PRD 感知补充项 | T3.2 |
| T5.3 | HTML 右键菜单：12 项四组、二级菜单、勾选态实时同步（角色右键与托盘同源） | menu.js、menu.css | **A6** 及菜单全项 | T1.4、T3.4、T5.1 |
| T5.4 | 设置窗口四页签（PRD §3.3）：成长/换装/提醒/通用，与主窗实时同步，含「跳舞不可用」态 | settings.html/js | **A16** | T3.1、T5.1 |
| T5.5 | 音效合成：跳跃/落地/开心/提醒/番茄完成 5 个 8-bit 音效（numpy 合成 wav） | gen_sfx.py、sfx/ | 事件触发有声 | - |

### M6 打包与总验收（产出：交付 exe）
| # | 任务 | 产出 | 验收 | 依赖 |
|---|---|---|---|---|
| T6.1 | 开机自启（setLoginItemSettings）+ 开关三方同步 | main.js 扩展 | **A28** | T5.3 |
| T6.2 | electron-builder：portable 配置、asarUnpack、图标、存档路径（PORTABLE_EXECUTABLE_DIR） | build 配置 | exe 双击即用 | M5 全部 |
| T6.3 | 持久化全链路：退出/重启/杀进程/损坏档案恢复验证 | - | **A26、A27、A29** | T6.2 |
| T6.4 | **A1–A29 全清单走查**：按 PRD §9 逐条执行、记录、修复回归 | 验收记录表 | 全部勾选 | T6.2 |

---

## 五、风险与预案

| # | 风险 | 概率 | 预案 |
|---|---|---|---|
| R1 | node-nowplaying 编译失败（Node ABI 不匹配） | 中 | 尝试 prebuild → electron-rebuild；仍失败按 K8 自动禁用跳舞，**不阻塞交付**（PRD 允许） |
| R2 | 网易云非官方接口变动/限流 | 中 | 降级链三层（歌手页→5 首兜底→哼唱）；所有请求超时+单次重试；24h 缓存减少调用 |
| R3 | AI 素材帧间不一致（闪烁） | 中 | K6 降级策略：单帧+CSS transform；先做 4 个关键动作（走/唱/跳/睡）验证流水线再批量 |
| R4 | portable exe 存档写丢（临时目录坑） | 高发坑 | K9 已规避：PORTABLE_EXECUTABLE_DIR 优先 + 不可写回退 userData；T6.3 专项验证 |
| R5 | 手势冲突（单击误判双击、拖拽误判点击） | 低 | K3 阈值调参（250/400ms、6px）留配置项，T2.3 实测校准 |
| R6 | 透明窗口在某些 Win 显卡驱动下发黑 | 低 | 关硬件加速开关兜底（`app.disableHardwareAcceleration()`），保留开关位 |
| R7 | 双显示器 workArea 取错屏 | 中 | V1 明确锁定主屏（PRD 已界定），代码注释预留多屏接口 |

---

## 六、验收走查顺序（T6.4 执行用）
1. 静态项：A1 双击运行 → A2 透明无框 → A29 退出无残留
2. 窗口项：A3 置顶 → A4 穿透 → A5 缩放透明度 → A6 右键菜单
3. 行为项：A7 行走 → A8 闲置/睡觉 → A9 惊醒 → A10 单击 → A11 拖拽 → A12 甩出
4. 音乐项：A17 双击点歌 → A18 停止 → A20~A22 跳舞三连 → A19 断网降级
5. 成长项：A13 计数 → A14 档位台词 → A15 升级解锁 → A16 成长页
6. 工具项：A23 久坐喝水 → A24 番茄钟 → A25 便签 → 感知补充项
7. 持久项：A26 重启保档 → A27 重启电脑 → A28 自启 → A29 存档位置确认
- 走查全程记录 PRD §9 副本勾选，发现缺陷当场登记、修复后回归该项及其相邻项

---

## 七、交付物清单
1. `洛天依桌宠.exe`（portable 单文件，M6 产出）
2. 源码仓库（本目录，含 scripts 可重建素材）
3. 素材源文件（AI 原图 + 切帧脚本，可再生成）
4. 验收记录表（A1–A29 勾选结果）
5. 使用说明（简版：双击运行、菜单说明、数据目录位置、常见问题）
