# 洛天依桌宠 · luotianyi-pet

一只跑在 Windows 桌面上的 Q 版洛天依桌面宠物。她会沿任务栏散步、发呆、打瞌睡，能摸摸、能拖拽甩飞、能点歌陪你听，还会**跟着系统正在播放的音乐一起跳舞**。

> 个人自用项目：**双击单个 exe 即可运行**（绿色免安装），无需登录、无需账号，所有数据保存在本机。
> 形象与名称版权归上海禾念所有，本项目为个人二创，不分发、不传播。

---

## 目录

- [功能特性](#功能特性)
- [技术栈](#技术栈)
- [目录结构](#目录结构)
- [快速开始](#快速开始)
- [命令行参数](#命令行参数)
- [数据与存档](#数据与存档)
- [形象动画与序列帧](#形象动画与序列帧)
- [跟随系统音乐跳舞](#跟随系统音乐跳舞)
- [测试与验收](#测试与验收)
- [文档索引](#文档索引)
- [已知限制](#已知限制)
- [版权与许可](#版权与许可)

---

## 功能特性

### 桌面陪伴
- **无边框透明悬浮窗**（300×420），置顶、可穿透、滚轮缩放（50%~200%）、Ctrl+滚轮调透明度（20%~100%）
- **待机静止**：无操作时她原地待机不动，不会自己满屏乱跑
- **走路有方向**：向右走朝右、向左走朝左，走到屏幕边缘自动折返
- **闲置行为**：闲置约 30 秒随机发呆 / 走路 / 哼唱；连续 2 分钟无操作进入睡觉（头顶 ZZZ），单击惊醒

### 鼠标交互
| 操作 | 效果 |
|---|---|
| 单击 | 随机跳跃 / 抖动 + 台词气泡，好感 +1（10 秒内连点不重复计） |
| 双击 | 随机播放一首洛天依歌曲 + 逐句歌词；唱歌中再双击 = 停止 |
| 按住拖动 | 抓起角色自由移动（"被拎起"姿态） |
| 快速甩动松开 | 按甩出方向飞出、重力下落、落地弹跳 |
| 右键 | 打开与托盘一致的 14 项主菜单 |

### 成长与台词
- **等级经验**：陪伴 +1/分钟、单击互动 +2、听完一首歌 +15、完成番茄钟 +10
- **好感度**：0~100 五档（陌生 / 熟悉 / 朋友 / 亲密 / 挚爱），影响台词风格；长期不互动会缓慢衰减（不会跑路）
- 台词库按「场景 × 好感档位」抽取，气泡显示约 4 秒

### 音乐点歌
- 从网易云「洛天依」歌手页随机抽歌在线播放，逐句 LRC 歌词高亮
- 三层**降级链**：歌手页接口失败 → 内置 5 首兜底 → 断网则切「哼唱模式」并给出提示台词

### 跟随音乐跳舞
- 任意软件（网易云、Chrome、QQ 音乐…）连续播放 ≥5 秒，她自动原地跳舞；停止 ≥10 秒后回到之前状态
- 唱歌优先：唱完若系统音乐仍在放，自动接上跳舞
- 采用 **SMTC + Core Audio 双通道**检测，解决「网易云不上报 SMTC」的问题（见下文）

### 提醒与感知
- **提醒四件套**：久坐 / 喝水 / 番茄钟（倒计时徽章）/ 便签（可每天重复）
- **系统感知**：电量 ≤20% 且未充电提醒一次；CPU 持续 >85% 达 30 秒吐槽一次（10 分钟冷却防刷屏）

### 托盘与设置
- **托盘 / 角色右键菜单**：14 项四组（音乐 / 窗口 / 互动 / 系统），含「游戏模式（强制可交互）」「把小人叫回屏幕右下角」等高频操作
- **设置窗口**：成长 / 换装 / 提醒 / 通用 四个页签，与主窗状态实时同步
- **游戏模式**：右键菜单/设置页勾选，或按 `Ctrl+Shift+G` 切换；开启后整个小人窗口强制可交互，解决部分游戏/全屏场景下因光标被捕获而无法点击小人的问题
- 开机自启（注册表 Run 键）、空壳换装（当前仅默认装）

---

## 技术栈

| 项 | 选型 |
|---|---|
| 运行时 | Electron ^31（主进程 Node.js + 渲染层原生 HTML/CSS/JS ES Module） |
| 前端 | **无框架**，原生 DOM + Canvas 逐帧绘制 + SVG 骨骼动画 |
| 形象 | 序列帧动画（PNG-32 带 alpha），SVG `Rig` 作为无序列帧时的回退 |
| 物理 | 自研简易抛物线模拟（速度 / 重力 / 弹性） |
| 媒体检测 | PowerShell + WinRT SMTC，PowerShell + 内联 C# 调 Core Audio（WASAPI） |
| 音效 | Python 脚本合成 8-bit 短音效（`scripts/gen_sfx.py`） |
| 打包 | electron-builder `win portable` 单文件 exe |
| 测试 | 自研 Node 测试运行器 `tests/run-all.mjs`（无第三方测试框架） |

---

## 目录结构

```
luotianyipet/
├── package.json              入口、脚本（start / test / build）与打包配置
├── README.md                 本文件
├── docs/
│   ├── DESIGN.md             设计附册（界面图示与数值表）
│   ├── DEV_PLAN.md           开发计划（里程碑、技术决策 K1~K10、风险预案）
│   ├── ACCEPTANCE.md         A1~A29 验收记录
│   └── LINES.md              台词库总览（505 句，从 dialogue.js 自动导出）
├── build/                    打包资源（icon.png）
├── scripts/                  Python 辅助脚本
│   ├── gen_icon.py           图标生成
│   └── gen_sfx.py            音效合成
├── src/
│   ├── preload.cjs           contextBridge 白名单 API（window.petApi）
│   ├── shared/               主进程与渲染层共用模块
│   │   ├── menumodel.js      菜单数据源（托盘与角色右键同源）
│   │   ├── profile.js        存档结构定义与校验
│   │   ├── winpos.js         窗口位置夹取（整窗可见 / 右下角落点）
│   │   ├── lrc.js            LRC 歌词解析
│   │   └── sysjudge.js       系统感知阈值判定
│   ├── main/                 主进程
│   │   ├── main.js           入口：窗口、生命周期、单实例、smoke/selftest 钩子
│   │   ├── ipc.js            全部 IPC 通道注册
│   │   ├── tray.js           托盘图标与原生菜单
│   │   ├── store.js          存档：防抖 / 定时 / 退出保存 / 损坏恢复
│   │   ├── media.js          SMTC + Core Audio 双通道媒体监听（核心）
│   │   ├── netease.js        网易云请求代理（无 CORS 限制）
│   │   ├── sysinfo.js        CPU 采样
│   │   └── autostart.js      开机自启（注册表 Run 键）
│   ├── renderer/
│   │   ├── index.html        桌宠窗口
│   │   ├── settings.html     设置窗口
│   │   ├── css/              pet.css / menu.css / settings.css
│   │   └── js/
│   │       ├── pet.js        渲染层入口，装配各模块
│   │       ├── fsm.js        行为状态机（核心）
│   │       ├── sprite.js     序列帧动画层（SpriteLayer）
│   │       ├── animation.js  SVG 骨骼动画引擎（Rig，回退）
│   │       ├── physics.js    抛出物理模拟
│   │       ├── interact.js   手势系统（单击 / 双击 / 拖 / 甩）
│   │       ├── geo.js        命中检测（透明区穿透）
│   │       ├── bubble.js     气泡 / 歌词条 / 徽章 UI
│   │       ├── menu.js       HTML 右键菜单
│   │       ├── growth.js     等级 / 经验 / 好感 / 解锁
│   │       ├── dialogue.js   台词库加载与抽取
│   │       ├── music.js      播放控制
│   │       ├── dance.js      跳舞判定（消费媒体事件）
│   │       ├── reminders.js  提醒四件套
│   │       ├── settings.js   设置窗口逻辑
│   │       ├── sfx.js        音效播放
│   │       ├── selftest.js   真实环境自检
│   │       ├── windowctl.js  窗口控制
│   │       ├── outfit.js     换装
│   │       ├── palettes.js   配色变量
│   │       └── bus.js        事件总线
│   └── assets/
│       ├── sprites/          序列帧（8 动作 × 16 帧）
│       ├── sfx/              音效 wav
│       └── icon-tray.png     托盘图标
├── tests/                    自研单测 / 集成测试（test-*.mjs）
├── data/                     运行时存档（profile.json、profile.bak，不入库）
└── dist/                     打包输出（洛天依桌宠.exe，不入库）
```

---

## 快速开始

### 环境要求
- Windows 10 / 11
- Node.js（开发用；运行打包后的 exe 无需 Node）

### 开发运行

```bash
npm install          # 安装依赖（Electron 等）
npm start            # 启动桌宠
```

> ⚠️ **重要**：若你的环境里设置了 `ELECTRON_RUN_AS_NODE` 环境变量，启动前必须清除，否则 Electron 会被当成纯 Node 运行而报错：
> ```bash
> env -u ELECTRON_RUN_AS_NODE npm start
> ```

### 运行测试

```bash
npm test             # 等价于 node tests/run-all.mjs，运行 tests/ 下全部用例
```

### 打包为单文件 exe

```bash
npm run build        # electron-builder --win portable
# 产物：dist/洛天依桌宠.exe（绿色免安装，双击即用）
```

---

## 命令行参数

打包后的 exe 与开发态均支持以下参数（主要用于自动化验证与排查）：

| 参数 | 作用 | 退出码 |
|---|---|---|
| `--smoke` | 冒烟测试：主窗 + 设置窗渲染就绪后退出 | 0 就绪 / 1 致命 / 2 超时 |
| `--selftest` | 渲染层端到端自检，逐步上报结果后退出 | 0 全过 / 3 超时 |
| `--media-debug` | 打印媒体检测状态与判定来源通道（smtc / audio） | — |
| `--win-debug` | 打印窗口显示来源、bounds、屏数与工作区（排查「小人不出现」） | — |
| `--reset-pos` | 忽略存档位置，把窗口放回主屏右下角默认落点 | — |
| `--gpu-on` | 跳过软件渲染开关，改用默认 GPU 合成（排查透明窗口不绘制） | — |
| `--dump-state` | 导出当前存档 JSON 后退出（持久化测试用） | 0 |
| `--apply-patch <json>` | 应用一段存档补丁后退出（测试用） | 0 成功 / 1 失败 |

> 打包后的 exe 属 GUI 子系统，stdout 不回挂控制台，**只认退出码**。

---

## 故障排查

### 能看到托盘图标、音乐也能放，但桌面上看不到小人

这是**透明窗口被隐藏或跑到屏幕外**造成的，与功能是否正常无关（主进程一直在工作）。两条已知成因都已做防护：

1. **显示事件未触发**：窗口以 `show:false` 创建，早期实现只依赖 `ready-to-show` 显示窗口——而该事件在部分机器/显卡环境下会**永不触发**（Electron 已知问题，官方文档注明与 `paintWhenInitiallyHidden`、fullscreen、preload 等多种场景相关）。现在叠加 `did-finish-load`、`did-fail-load` 与 3 秒超时三重兜底，任一先到即显示。
2. **窗口落在屏幕外**：桌宠是 300×420 的透明窗口，只要大部分离开工作区就等于"消失"。现在初始位置、拖动落点、显示前都会把窗口夹取到工作区内，并要求至少 60% 面积可见。
3. **个别显卡上透明窗口完全不绘制**（少数情况）：默认走软件渲染（R6 预案，规避 GPU 子进程崩溃）。若前两条都排除——即 `--win-debug` 显示 `visible=true` 且 bounds 正常，但屏幕上仍看不到——可加 `--gpu-on` 改用默认 GPU 合成再试，用于确认是否为渲染层问题。

**自助恢复**（任选其一）：
- 托盘图标 → 右键 → **窗口 → 把小人叫回屏幕右下角**
- 命令行运行 `洛天依桌宠.exe --reset-pos`
- 删除存档里的 `pos` 字段（`data/profile.json`），或直接删掉该文件

**诊断**：用 `--win-debug` 启动可看到 `[app] window-shown via=... bounds=... visible=... displays=...`，据此判断是"从未显示"（`via` 为 `timeout-fallback`）、"显示在屏外"（`bounds` 超出工作区），还是"显示了但没画出来"（`visible=true` 却看不见）。

---

## 数据与存档

- 存档文件：`data/profile.json`（另有写入前的备份 `data/profile.bak`）
- **目录优先级**：
  1. portable exe 同目录（`PORTABLE_EXECUTABLE_DIR/data`）
  2. 开发态项目目录 `data/`
  3. 不可写时回退 `%APPDATA%\LuoTianyiPet\data`
- **保存时机**：数值变化防抖 2 秒 + 每 5 分钟定时 + 退出前保存
- **损坏恢复**：主档损坏时自动用 `.bak` 恢复，不会清零好感与等级
- 存档字段：等级 / 经验 / 好感 / 陪伴分钟 / 互动次数 / 听歌数 / 已解锁项 / 当前服装 / 窗口位置 / 全部设置 / 便签列表

---

## 形象动画与序列帧

角色表现由 **`SpriteLayer`（序列帧 canvas）** 与 **`Rig`（SVG 骨骼）** 两层组成：有序列帧资源的动作走逐帧绘制，无资源的动作回退 SVG。

当前已接入 **8 个动作**，每个动作 16 帧 PNG（`src/assets/sprites/<动作名>/frame_001.png` …）：

| 动作 | 帧率 | 循环 | 说明 |
|---|---|---|---|
| `idle` 待机 | 6 | ✓ | 呼吸微动 |
| `walk` 行走 | 8 | ✓ | 正面循环；`walk-right` / `walk-left` 共用帧，靠 `scaleX(-1)` 镜像区分左右 |
| `sit` 坐下 | 4 | ✓ | 前 4 帧为坐下过渡（`introCount:4`），之后坐姿循环，不会再自己站起 |
| `sleep` 睡觉 | 2 | ✓ | 头顶 ZZZ |
| `sing` 唱歌 | 6 | ✓ | |
| `dance` 跳舞 | 8 | ✓ | |
| `grabbed` 被拎 | 6 | ✓ | 悬空姿态 |
| `jump` 跳跃 | 8 | ✗ | 单次播放 |

动作配置集中在 `src/renderer/js/sprite.js` 的 `SPRITE_ACTIONS`，`fsm.js` 会把内部状态映射到这些动作（如 `daze`/`hum` → `idle`，`dance1/2/3` → `dance`）。

### 新增一个动作

1. 把处理好、**统一画布尺寸**（脚底基准线与水平中心对齐）的透明 PNG 帧放入 `src/assets/sprites/<动作名>/`，按 `frame_001.png` 顺序编号；
2. 在 `src/renderer/js/sprite.js` 的 `SPRITE_ACTIONS` 加一行 `{ fps, loop, dir }`；
3. 需要"先过渡、后循环"时加 `introCount: N`（前 N 帧只播一次）。

---

## 跟随系统音乐跳舞

这是本项目较有技术含量的部分。链路为：

```
主进程 media.js 每 5s 轮询 → 广播 media:status → 渲染层 dance.js（DanceJudge）
  → 外部媒体持续播放 5s 开始跳舞 / 停止 10s 结束 → fsm.beginDance
```

**双通道判定**（任一为真即认为系统在播放媒体）：

| 通道 | 原理 | 特点 |
|---|---|---|
| ① SMTC | PowerShell 调 WinRT `GlobalSystemMediaTransportControlsSessionManager` | 精确，但**依赖应用主动上报** |
| ② Core Audio | PowerShell + 内联 C# 调 `IAudioSessionManager2`（WASAPI） | 只要进程在输出音频（state=Active）即可感知，**不依赖应用配合** |

> ⚠️ **为什么需要通道二**：网易云音乐桌面版**不向 SMTC 注册媒体会话**（实测播放时 SMTC 里只有 Chrome），仅靠 SMTC 会出现"Chrome 能跟着跳、网易云不能跳"。通道二补上了这个缺口。

**踩坑与处理**：
- PowerShell 无法把 COM 对象转成自定义接口，Core Audio 交互必须整体写进内联 C#（`Add-Type`）；
- PowerShell 重定向输出中文进程名会乱码 → 进程名走 **Base64** 传输，Node 端解码；
- 排除名单 `AUDIO_IGNORE_PROCESSES`：`wallpaper*`（壁纸引擎）、`audio_web_helper`（音频可视化插件）、`audiodg`、`svchost`，以及 `pid<=0` 和桌宠自身——这些进程会长期 Active，不排除会导致"一直在跳舞"；
- 监听失败改为**指数退避重试**（5s→30s 封顶），**永不自动停止**（旧版把"无会话"误判为"不可用"会在 ~15s 后永久停听）。

排查工具位于 `.workbuddy/tmp/`（已忽略入库）：`run_ps.mjs`（用 node spawn 跑 ps1）、`audio_list.ps1`、`smtc_deep_probe.mjs`、`verify_dual.mjs` 等。

---

## 测试与验收

- 测试运行器：`tests/run-all.mjs`，自动发现并执行 `tests/test-*.mjs`，汇总通过/失败数
- 覆盖模块：动画、状态机、物理、手势、菜单、成长、台词、音乐、歌词、网易云、媒体检测、提醒、存档、窗口控制、音效、图标、系统感知等
- 验收：`docs/ACCEPTANCE.md` 按 A1~A29 逐条记录验证方式与结果
- 运行测试：`npm test`；打包后可用 `dist/洛天依桌宠.exe --smoke` 与 `--selftest` 做端到端冒烟

> 说明：`tests/test-persist.mjs` 会启动**真实 Electron 进程**，以下两点任一不满足都会让该用例失败：
> ① 当前 shell 不能带 `ELECTRON_RUN_AS_NODE`（否则 Electron 被当纯 Node 启动，见[快速开始](#快速开始)）；
> ② **桌宠本体不能正在运行**——`洛天依桌宠.exe` 与开发态共用用户数据目录，其单实例锁文件
> （`%APPDATA%\luotianyi-pet\lockfile`）会让新进程 `requestSingleInstanceLock()` 失败后**静默退出**
> （exit 0 但无 `STATE:` 输出）。跑测试前先退出桌宠即可。

---

## 文档索引

| 文档 | 内容 |
|---|---|
| [`docs/DEV_PLAN.md`](docs/DEV_PLAN.md) | 开发计划：里程碑 M0~M6、技术决策 K1~K10、风险预案 |
| [`docs/DESIGN.md`](docs/DESIGN.md) | 设计附册：界面结构、交互规范、成长数值表 |
| [`docs/ACCEPTANCE.md`](docs/ACCEPTANCE.md) | A1~A29 逐条验收记录与证据 |
| [`docs/LINES.md`](docs/LINES.md) | 台词库总览：17 个场景 × 5 档好感度，共 505 句 |

> 原 `PRD.md` 已移除；需求口径与验收标准现由 `docs/DEV_PLAN.md`（里程碑与技术决策）与 `docs/ACCEPTANCE.md`（A1~A29 验收）承载。

---

## 已知限制

- 仅支持 **Windows**，且锁定主显示器（多屏走动为 V2 候选）
- 行走序列帧为**正面循环**，左右方向靠镜像区分；若要真正的侧视左右走需替换为侧视帧
- 跟随跳舞为**固定节奏**，不做逐拍同步（V2 考虑音频节拍检测）
- 音乐依赖网易云非官方公开接口，接口变动时走降级链（兜底 5 首 → 哼唱）
- 换装当前仅保留默认装，旧版多套服装已移除

---

## 版权与许可

- 洛天依形象与名称版权归**上海禾念**所有；本项目为个人自用二创，**仅供本人观赏，不分发、不传播**。
- 代码许可：`UNLICENSED`（个人自用，未开源授权）。
