# B站 AI 视频总结（Chrome / Edge 扩展）

读取 B 站视频页面的信息与字幕，调用**你自己配置的** OpenAI 兼容模型生成摘要、知识点与带时间戳的章节；没有字幕时可以改用画面识别；结果可导出 Markdown、思维导图 SVG / PNG、幕布大纲与字幕 txt。

[![release](https://img.shields.io/github/v/release/522963969/bilibili-ai-summary)](https://github.com/522963969/bilibili-ai-summary/releases/latest)

**不想装 Node？** 直接下载安装包就行 —— [最新版本 Releases](https://github.com/522963969/bilibili-ai-summary/releases/latest)，解压后在浏览器里「加载已解压的扩展程序」，详见 [§1.3](#13-在浏览器中加载)。包内附 `START-HERE.html` 图文说明。

> 注意：Chrome / Edge 不允许直接安装 zip 或 crx，「解压 + 开发者模式加载」这三步无法省略，这是浏览器侧的限制。

> **当前版本：1.0.2（正式版）**，可上架 Chrome 应用商店。
>
> 已实现：Manifest V3 工程、Popup、设置页、强类型消息通道、设置持久化、B 站视频识别与页面上下文采集、字幕轨道发现与下载、SRT / VTT / JSON 导入、字幕规范化与本地缓存、页面内信息栏入口与按钮下方就地展开的面板、OpenAI 兼容模型连通性测试、分块并发总结（概述 + 章节，章节可点击定位）与断点续跑；无字幕视频的画面抽帧识别（抽帧 + 视觉模型逐帧描述 + 来源标签 + 讲稿断点复用）；字幕全文展开与 txt 导出；导出 Markdown 文件与幕布大纲；**知识点卡片 + 思维导图（面板内预览，可导出 SVG / PNG）**；单块直出与章节覆盖度保护；素材指纹与错配快照拦截；**结果区素材核对（视频键 / 首句原文 / 时长三重比对，对不上就告警并给出「改用平台字幕」）**。
>
> 尚未实现：信息图（信息图排版，与思维导图是两种图）、历史记录与去重、音频转写。这三项在 Popup 的「功能状态」里标为**暂未支持**，界面上不提供可点击的假按钮；manifest 的简介也只写已实现的能力。

---

## 1. 快速开始

### 1.1 环境要求

| 项目 | 版本（实测通过） |
| --- | --- |
| Node.js | v22.22.2（要求 ≥ 20） |
| npm | 10.9.7 |
| Chrome / Edge | Chromium 100+（实测 Edge 156） |

### 1.2 安装与构建

```bash
git clone https://github.com/522963969/bilibili-ai-summary.git
cd bilibili-ai-summary
npm install
npm run build      # 先执行 vue-tsc 类型检查，再产出 dist/
```

构建产物位于 `dist/`，即为可加载的扩展目录。不想装 Node 也可以直接取 `release/` 下的分享包（见 §10.2）。

### 1.3 在浏览器中加载

1. 打开 `chrome://extensions/`（Edge 为 `edge://extensions/`）。
2. 右上角开启「开发者模式」。
3. 点击「加载已解压的扩展程序」，选择本项目的 **`dist` 目录**（不是项目根目录）。
4. 固定扩展图标到工具栏。首次安装会自动打开设置页。

> **从 Releases 下载的 zip**：先解压，再在第 3 步选**解压出来的那一层**（里面直接有 `manifest.json`）。选成上一级会提示「清单文件缺失或不可读取」。解压位置不要放「下载」目录，也别事后移动——开发者模式扩展是从那个目录实时读取的，一动就失效。

> **浏览器兼容性**：`minimum_chrome_version` 已降到 `100`，但部分国产 Chromium 内核浏览器（如 360 安全浏览器 16.x，内核约 108–114）对 MV3 的支持不完整，加载 `dist` 时可能仍报版本错误。请使用 Chrome / Edge / 其他完整支持 MV3 的浏览器。若报 `This extension requires Google Chrome version N or greater`，说明该浏览器的内核版本低于 `manifest.json` 中的门槛，换浏览器即可。

### 1.4 使用

**一次性配置**

1. 在设置页填写 **API Base URL / API Key / 模型名称**，点击「授权该域名」，再点击「保存设置」。
2. 点击 **测试连接**：扩展会用已保存的配置向模型发一条最小请求（「只回复两个字：可用」），并把模型名与耗时显示在下方。未保存的修改不会参与测试，界面会直接拦下并提示先保存。

**日常使用（页面内入口）**

3. 打开任意 B 站视频播放页（`https://www.bilibili.com/video/BV...`）。
4. 播放页右栏位置会出现 **「AI 总结视频」** 入口。它是一层**固定定位的浮层**，不参与页面布局——这是被迫的取舍：B 站右栏整棵子树由页面自己的 Vue 实例渲染，往里插外来节点会打乱它的子节点 diff，导致评论组件根本不被创建（详见 §7）。点击后在入口下方展开面板，宽度跟随右栏、向下滚动时在页头下方吸顶；再点一次或点面板右上角 × 收起。面板里显示当前视频标题与 UP 主（身份来自 `sender.tab`，不需要 activeTab 权限）。
5. 在面板中点 **获取字幕**（用你当前浏览器的登录态请求 B 站字幕），或点 **导入文件** 选择本地 SRT / VTT / JSON。拿到字幕后会显示条数、总时长、来源与前 3 条时间戳预览，可点 **展开全部** 查看全文、点 **下载 .txt** 保存字幕原文。
6. 点 **开始总结**：按设置里的分块参数切块，并发调用模型生成分段摘要，再归并成「概述 + 章节」。章节带时间戳，点击即跳转到播放器对应位置。
7. **视频没有字幕时**：总结卡片会说明「这个视频没有可用字幕」，并提供 **按画面识别生成总结**（需先在设置页配置一个支持图片输入的视觉模型，见 1.7）。点击后扩展会在页面上逐帧抽取关键画面、交给视觉模型描述，再据此生成总结。抽帧期间视频会短暂暂停，完成后自动回到原来的播放位置与状态。
8. 面板可随时关闭；任务在后台继续，重新打开会读回进度（进度持久化在 `chrome.storage.local`）。
9. 结果出来后可以**下载 .md**，或点 **复制到幕布** 把大纲复制到剪贴板并打开幕布工作台，粘贴即可生成层级（见 1.8）。

**Popup**

10. 点击工具栏图标可查看当前视频信息与模型配置状态；底部「打开页面侧边面板」会直接展开页面内的面板（未在视频页时按钮禁用）。

### 1.5 字幕获取的四种真实结果

字幕接口返回什么，界面就显示什么，不做兜底猜测。**四种结果对应四种不同原因**，混为一谈会把用户引向错误的下一步（去登录一个根本不需要登录的视频、或者去解一个不存在的「锁」）：

| 状态 | 含义 | 界面提示 |
| --- | --- | --- |
| `ok` | 发现可用轨道 | 自动挑选一条（优先中文自动生成），下载后展示预览；若这条明显没覆盖到视频时长，会自动再试下一条并选用覆盖更全的那条；轨道多于一条时在字幕卡片列出全部轨道供手动切换；另有被锁定的轨道时，提示里会写明「另有 N 条被平台锁定」 |
| `login-required` | 当前会话未登录，接口只列轨道不给地址（`login_mid = 0`），或该视频字幕必须登录才可见（`need_login_subtitle = true` 且零轨道） | 提示先登录 B 站账号再重新获取 |
| `empty` | 视频本身没有字幕 | 提示可导入本地字幕文件 |
| `all-locked` | 轨道被平台标记为 `is_lock = true`，接口不返回 `subtitle_url` | 提示这是平台侧的观看权限限制（充电专属 / 付费内容 / UP 主限定常见），登录不会解除；给出「导入本地字幕」「画面识别」两条替代路径 |

**为什么有的视频提示「需要解锁」**：`player/v2` 的 `subtitles[]` 里每条都带 `is_lock` 与 `subtitle_url`。锁定轨道的 `subtitle_url` 是空串——不是我们请求失败，而是平台压根没给下载地址。实测（2026-10，未登录会话，BV1GJ411x7h7）`view.subtitle.list` 返回 12 条轨道、`subtitle_url` 全为空，且 `is_lock` 有真有假，说明这个标记是**按轨道**给的，不是「整个视频要不要付费」。

区分这两件事很重要：未登录时**所有**轨道的地址都是空，旧实现只要「有轨道但都拿不到」就报「需要解锁」，等于把登录问题说成了权限问题。现在只有 `is_lock` 全部为真才报 `all-locked`，其余「有轨道、没地址」的情况一律按登录受限处理。

**一个视频可以有多条轨道，而第一条不一定能用。** 真实反馈：24 分 34 秒的视频点「获取字幕」，只拿到 1 条、10 秒的字幕（内容是「保存头像 用微信扫呀」这类推广语）。旧实现直接取「第一条非锁定且有地址」的轨道，那条恰好是占位字幕，界面上只显示「1 条 · 10 秒」，既看不出哪里不对，也没有任何切换入口。现在做三件事：① 默认优先选中文自动生成轨道；② 拉下来先量覆盖率，明显不够用就继续试下一条（最多 3 条），选覆盖最全的那条；③ 字幕卡片显示轨道名与全部轨道，覆盖率不足时直接提示「这条字幕只有 1 条，而这个视频有 24:34」，并给一个「重新读取轨道并自动挑选」的按钮。

### 1.6 总结是怎么算出来的

分块与并发参数集中在设置页，默认取需求约定值：目标 6000 tokens / 上限 8000 tokens / 重叠 30 秒 / 并发 2 / 最大重试 3。

1. **分块**：按设置的目标与上限 token 切块，块与块之间按「重叠秒数」回退若干 cue，避免一句话被切断后语义丢失。token 用「ASCII 按 4 字符计、宽字符按 1 字符计」估算，对中文偏保守（宁可多切一块，不让单次请求超限）。
2. **分段摘要**：每块带 `[mm:ss]` 时间戳前缀送入模型，并发执行；可重试的错误（429 / 5xx 等）按 `400ms × 尝试次数` 退避重试。
   **只有一个分块时跳过这一步**，直接把整段带时间戳的字幕交给模型出结构化结果——先压成两百字再归并会让后半段的时间点整段消失（见 1.6.1）。
3. **断点续跑**：**每块摘要完成即写入 `summary-chunk/v1/<videoKey>`**，任务失败后重新点「开始总结」只补缺失的块，已完成部分不重复消耗 token。缓存带指纹（cue 数量 / 起止时间 / 分块参数），字幕或参数变化时整份缓存作废。
4. **归并**：所有分段摘要按时间顺序合并成「概述 + 要点 + 章节」。归并输入超过 12000 tokens 时按段均分预算截断，保证每段都保留部分信息。
5. **章节时间可追溯**：章节的开始时间来自模型对真实字幕时间点的引用，解析时校验格式；点击章节即 `video.currentTime = 秒数` 并播放。
6. **失败即终止**：任一块重试耗尽后整体失败，不会带着残缺的分块去归并，也不会返回不完整结果。

#### 1.6.1 章节只覆盖前半段的问题

真实反馈：一个 24 分 34 秒的视频，生成的章节最晚只到 `07:30`，后面 17 分钟点不到。原因是链路本身有两处缺陷，都已修掉：

| 缺陷 | 现象 | 修法 |
| --- | --- | --- |
| 单块也走「先摘要再归并」 | 24 分钟内容被压成约 200 字，章节时间点只能从这 200 字里挑，后半段整段丢失 | 单块时**直出**：把完整带时间戳字幕一次性交给模型，同时省掉一次调用 |
| 提示词没告诉模型素材有多长 | 只写了「章节 3~10 个，内容单一时可以更少」，模型总结完开头就收尾 | 请求里带上「素材范围：00:00 - 24:34」，并写明「第一个章节从开头附近开始、最后一个必须落在结尾附近」「超过 10 分钟至少每 5 分钟一个章节」 |

另外加了一层**覆盖度保护**：解析后计算「最后一章起点 / 素材终点」，低于 60%（且素材不短于 5 分钟）就带上「上次只覆盖到 07:30，素材一直到 24:34」再要一次；补全结果更完整才采用，补全失败则保留第一份，不会因为「想更好」而丢掉已经拿到的总结。

素材终点取最后一条字幕的结束时间，而不是页面上的视频时长——字幕可能只覆盖到某一段，用真实素材边界判定才不会误报。

即便这样，模型仍可能给出覆盖不足的章节。此时面板会在脚注下方**如实提示**「章节只覆盖到 00:00，素材一直到 24:34」，而不是让用户以为后面没有内容。

### 1.7 没有字幕时：按画面识别

无字幕场景不靠猜，也不靠伪造「转写结果」。当前实现走的是一条**可验证**的路径：把视频画面本身作为素材。

**技术前提（2026-10 实测，无头 Edge + 真实 B 站页面）**

| 结论 | 证据 |
| --- | --- |
| Content Script 可以直接对页面里的 `<video>` 抽帧 | 隔离世界与页面共享文档，canvas 污染判定与 world 无关 |
| canvas 不会被跨域污染，**不需要 `tabCapture`** | B 站自身给 `<video>` 标了 `crossOrigin="anonymous"`，MSE 的 `blob:` 源同源；`drawImage` → `toDataURL` 未抛 `SecurityError`，`getImageData` 可读 |
| 读到的是真实画面而非空白帧 | 160×90 采样：非黑像素占比 0.71、平均亮度 103、39 种色阶 |
| 单帧体积可接受 | 512 宽 + JPEG 0.6 时约 13–18 KB |
| 抽帧的主要成本是 seek | 逐点定位平均约 80 ms（实测 196 ms 含固定等待） |
| 帧差可以区分「同一镜头」与「切镜」 | 0.5 s 间隔的 32×18 灰度平均绝对差：stdev 内约 1–5，切镜/大幅运动 15–60，阈值取 8 |

**流程**

1. **计划槽位**：按「保留帧最小间隔」把视频切成若干槽位。视频过长时自动放宽间隔（`时长 / 保留帧上限`），保证不超过帧上限，同时**不会截断后半段**。
2. **密集探索**：每个槽位内按采样频率探索多个候选点，取「与上一保留帧差异最大」的那个；差异小于阈值说明画面基本没变，整段跳过，不浪费模型调用。候选总数有预算上限（`保留帧上限 × 2`），因此抽帧耗时与视频长度弱相关。
3. **编码**：只对留下的时间点重新 seek 并编码为 JPEG，而不是把每个候选点都编码一遍。
4. **识别**：每 6 帧一批送视觉模型，要求按「序号 | 画面描述」逐行输出，**时间戳由我方按下标回填**，模型写乱顺序也不会错位。
5. **总结**：画面讲稿转成与字幕同构的 cue（文本带 `[画面]` 前缀），直接复用 1.6 的分块与归并管线，不需要第二套提示词。

**来源标签**：结果卡片右上角标注「字幕」或「画面识别」，素材条数也按来源显示为「N 条字幕」或「N 条画面描述」。字幕能听到说话，画面识别只能看到静帧，两者可信度与遗漏方式完全不同，混在一起会让用户误判结论的可靠程度。

**提示词差异**：画面来源使用单独的段落提示词，明确禁止编造对白与剧情（模型看不到声音），并要求画面中的文字（标题、代码、PPT 要点）原样摘录。

**断点与复用**

- 讲稿写入 `framescript/v1/<videoKey>`。完整的讲稿会让「按画面识别生成总结」直接跳到总结阶段，省掉数十秒抽帧。
- 中断的讲稿会保留并按**时间点去重**：重跑只识别尚未解析的帧，已花掉的模型调用不会白费。
- 重跑时已识别的时间点会通过 `content.startFrames.skipTimes` 传给页面，**连 seek 与 JPEG 编码都跳过**（`withoutKnownTimes`）。只做模型侧去重是不够的：帧还是要重新抽一遍，用户看到的就是「重复提取、重复识别」。
- 面板提供「重新识别」与「清除」，分别用于强制重抽与丢弃旧讲稿。

**模型不看图时必须立刻停**

最伤人的一种失败不是报错，而是「跑完整段视频、什么都没得到」。视觉模型被中转站静默丢掉 `image_url` 时正是这样：HTTP 200、`content` 是空串，我方解析出 0 条描述，然后继续抽下一批……13 分钟的视频要抽几分钟的帧，最后仍然 0 条。

因此 `FrameService.push` 里有一条硬规则：

| 情况 | 处理 |
| --- | --- |
| 一批里一条描述都没解析出来，且此前也没有任何描述 | **立刻失败**，不再抽剩下的帧 |
| 上一条成立且模型这一批返回的是**空串** | 立即失败，判定为「模型不看图」 |
| 上一条成立但模型返回了内容（格式不对） | 首次放行，**连续两批**都解析不出才失败 |
| 已经有描述、偶尔一批空返回 | 不失败，继续跑，用它已有的部分生成总结 |

失败时的错误信息会点名模型名与实际看过的帧数，并**原样带出模型的返回片段**——用户才能区分「模型不看图」与「模型答的格式不对」，而不是面对一句无用的「识别失败」。已在识别出的描述会写盘保留（`complete: false`），换模型后点「用已识别画面生成总结」可以直接用。

解析侧还有一层兜底：整批一个阿拉伯数字编号都没匹配上时，按**行序**对齐（`parseByPosition`），因为不少模型会写成「画面一：…」这种形式。但只回一行却对应多帧时不猜——那通常是整段总结，硬对齐会把结论挂到第一帧上，时间点就假了。

**取消要能真的停下**：抽帧循环在页面里，`frames.push` 的 `accepted` 只在下一批才被读到，而探索阶段可能几十秒不推批次。所以取消时面板除了 `summary.cancel` 还会发 `frames.stop`，由内容脚本置标志位，让 seek 循环在下一个候选点退出。

### 1.8 导出：Markdown 与幕布大纲

总结结果下方有两个导出按钮，都只对已生成的结果可用，不额外申请任何权限。

| 按钮 | 行为 | 产物 |
| --- | --- | --- |
| **下载 .md** | 把结果序列化为 Markdown，交给**页面顶层文档**下载 | `<视频标题>-AI总结.md` |
| **复制到幕布** | 先复制幕布大纲到剪贴板，成功后打开幕布工作台 | 剪贴板内容 + 新标签页 |
| **下载 .txt**（字幕卡片） | 把字幕原文导出为纯文本，每行一条并带时间戳 | `<视频标题>-字幕.txt` |

字幕导出格式（头部是来源与规模，正文一行一条，可直接搜索或二次加工）：

```text
【官方 MV】Never Gonna Give You Up - Rick Astley
视频：https://www.bilibili.com/video/BV1GJ411x7h7
字幕来源：B 站字幕（中文（中国大陆））
共 120 条 · 5 分 59 秒

[00:00] 第 1 条测试字幕内容
[00:03] 第 2 条测试字幕内容
```

文件带 UTF-8 BOM，Windows 记事本打开中文不乱码。字幕卡片同时支持**展开全文**：默认只显示前 3 条，点「展开全部 N 条」在 260px 高的滚动区里显示全部，时间戳可点击跳转到对应画面，再点「收起字幕」还原。

**Markdown 的结构**（时间戳是指向 B 站对应播放位置的真实链接）：

```markdown
# 【官方 MV】Never Gonna Give You Up - Rick Astley

> 总结依据：字幕
> UP 主：索尼音乐中国
> 视频：https://www.bilibili.com/video/BV1GJ411x7h7
> 生成：2026-10-27 16:20
> 模型：deepseek-v4-flash
> 素材：120 条字幕 · 分 2 段

## 概述
...

## 要点
- ...

## 章节

### [00:35](https://www.bilibili.com/video/BV1GJ411x7h7?t=35) 为什么要分块
- ...
```

来源是画面识别时，头部会写「总结依据：画面识别」、素材写「N 条画面描述」，不会自称字幕。

**为什么下载要交给页面**：面板是嵌在 B 站页面里的跨源 iframe，浏览器会把它发起的 blob 下载直接取消——实测 `Browser.downloadWillBegin` 拿到 `totalBytes` 后立刻变成 `canceled`，文件不落盘。因此 `下载 .md` 走 `export.download` → `content.download`，由页面顶层文档创建 Blob 并点击链接触发下载。这样做也不需要 `downloads` 权限。

**幕布为什么只做到「复制 + 打开」**：幕布没有公开的文档写入 API（第三方逆向接口不可靠，也不应授权），扩展无法直接往你账号里建文档。它支持的导入格式是 Xmind / Freemind / OPML / Markdown，网页端在主菜单点「+」导入。所以这里选的是一条不需要额外步骤的路径：复制带 **Tab 缩进**的大纲文本 → 打开幕布工作台 → 你 `Ctrl+V`，幕布按缩进生成层级，并可直接切成思维导图。

大纲文本形如（缩进用制表符，`→` 表示一级缩进）：

```text
【官方 MV】Never Gonna Give You Up - Rick Astley
→ 链接：https://www.bilibili.com/video/BV1GJ411x7h7
→ UP 主：索尼音乐中国
→ 总结依据：字幕
→ 素材：120 条字幕
→ 概述
→ → 这期视频用一个具体案例讲清了分块总结长视频的完整流程。
→ 要点
→ → 目标 6000 tokens、上限 8000 tokens
→ 章节
→ → 00:35 为什么要分块
→ → → 模型上下文有限，整段送进去会被截断
```

概述会按中文句末标点拆成多个子节点（最多 10 个，超出部分合并到最后一条），这样在思维导图里是一个个短主题而不是一大块文字。

**文件名规则**：`<视频标题>-AI总结.md`。标题里的 `\/:*?"<>|` 与换行会替换为空格，首尾的点会被去掉（Windows 会静默丢弃结尾的点），超过 60 个字符按码点截断（不会切碎 emoji）；标题读不到时回退到视频键（如 `BV1GJ411x7h7#p1`），再回退到「B站视频」。

### 1.9 知识点与思维导图（SVG / PNG）

面板的内容顺序是：概述 → **关键要点**（`result.highlights`）→ **章节**（带时间戳，可点击定位）→ **思维导图**。导图由结果现算，不落盘。

导图是三层结构，节点标签全部来自结果本身，没有一条是写死的示例文案：

```text
视频标题
├── 知识点                     ← highlights 的每一条
│   ├── 单次请求放不下整段字幕，必须切块
│   └── ...
└── 章节                       ← chapters 的每一条
    ├── 为什么要分块  00:35     ← 节点下方的小字是开始时间
    │   ├── 字幕总量远超单次请求上限
    │   └── ...
    └── 断点续跑  15:00
```

没有章节也没有时间戳时（例如结果只有概述），会用概述按句末标点拆成子节点兜底，保证不会出现一张只有孤零零一个根节点的空图。

| 按钮 | 行为 | 产物 |
| --- | --- | --- |
| **下载 .svg** | 矢量图，交给页面顶层文档下载 | `<视频标题>-思维导图.svg` |
| **下载 .png** | 先在面板内栅格化（2 倍分辨率）再下载 | `<视频标题>-思维导图.png` |

**渲染流程**（三步全在本地，不联网、不依赖第三方库）：

```text
core/mindmap/build.ts   结果 → MindNode 树（纯数据）
core/mindmap/layout.ts  树 → 每个节点的 x/y/宽/高（横向树，根在左，层级向右）
core/mindmap/svg.ts     布局 + 主题 → SVG 字符串
panel/svg-to-png.ts     同一份 SVG → canvas → PNG base64（仅在点「下载 .png」时执行）
```

几个必须知道的实现约束：

- **布局先量宽再定位。** 标签按「字宽单位」折行（中文 1 单位、ASCII 0.55 单位），最多 3 行、每行 17 单位；英文单词不会被从中间劈开。折行后的宽度决定节点宽，节点宽决定列宽，列宽才决定 x。先定位再量宽会算出互相重叠的框。
- **父节点对齐子节点的垂直中线。** 这会让父节点可能高于它的第一个子节点，所以画布高度按**所有节点的实际包围盒**取 min/max 再统一平移，而不是按「根节点在 y=0」硬算——后者会把顶部的知识点裁掉。
- **SVG 里不用 `foreignObject`。** Chromium 把带 `foreignObject` 的 SVG 画进 canvas 时输出空白，PNG 会是全透明。所以连线用 `<path>` 贝塞尔曲线，文字用 `<text>`，每个文字宽度都由 `wrapLabel` 预先算好，不依赖浏览器的自动换行。
- **配色跟随系统主题。** 面板 `prefers-color-scheme: dark` 时导图换成深色底（`#1b1e24`），否则一张白底图会直接糊在深色面板上。切换主题会重算，不需要重新生成总结。
- **PNG 是 2 倍分辨率。** 676×577 的导图画出来是 1352×1154，贴进文档和幻灯片不会发虚。canvas 默认是全透明的，所以落笔前先 `fillRect` 铺一层白底。
- **面板显示两种倍率。** 默认缩到容器宽度（能看清整体结构，但 12.5px 的字只剩 7px 左右）；点「放大到原始大小」按 1:1 显示并横向滚动读字，点「缩小到适配宽度」复原。控件旁边标着导图的真实像素尺寸。

导出复用已有的下载通道：SVG 以 UTF-8 文本传，PNG 以 base64 传（消息通道只能传 JSON，塞不了字节数组），由 Content Script 在页面顶层文档 `atob` 还原成 `Uint8Array` 再下载——和 Markdown 走的是同一条路，同样不需要 `downloads` 权限。

### 1.10 在 Microsoft Edge 中使用

扩展是标准 Manifest V3，Edge（Chromium 内核）与 Chrome 共用同一份产物，**不需要单独的构建**。本项目所有端到端验证本身就是在 Edge 156 上跑的，包含真实 B 站视频页上的注入、点击与面板渲染。

```text
Edge 地址栏输入 edge://extensions → 打开「开发人员模式」→「加载解压缩的扩展」→ 选 dist/
```

Edge 用户还有一条更省事的路：Edge 默认允许从 Chrome 应用商店安装扩展，装了会在扩展菜单里提示来源是「其他商店」，功能不受影响。所以即使不上架 Edge 加载项商店，Edge 用户也能用。

**为什么不担心兼容性**——用到的 API 只有这些，全是各 Chromium 浏览器行为一致的基础能力：

| 类别 | 用法 |
| --- | --- |
| `chrome.storage.local` | 设置与总结缓存 |
| `chrome.runtime` | `onMessage` / `sendMessage` / `getURL` / `openOptionsPage` / `onInstalled` |
| `chrome.tabs` | `query` / `get` / `sendMessage` / `create` |
| `chrome.permissions` | `contains` / `request`（按域名授权模型服务） |

刻意避开了各浏览器实现有差异的 API：没有用 `chrome.sidePanel`（Edge 的侧栏形态不同）、`chrome.offscreen`、`chrome.declarativeNetRequest`、`chrome.scripting`；也没有远程代码、native messaging 或 WASM。面板是内容脚本注入的 `iframe` + Shadow DOM，与浏览器自身的侧栏 UI 无关，因此外观在两家浏览器里完全一致。

`manifest.json` 里的 `minimum_chrome_version: 100` 是 Chromium 通用字段，Edge 按其内核版本比对（Edge 100 发布于 2022 年），实际不构成门槛。

**要额外做什么**：只有上架才需要。Edge 加载项商店是**独立的开发者后台**，同一个 zip 可直接上传，但表单要另填一份（隐私政策 URL、类别、年龄分级、支持语言、开发者身份验证），截图要求最低 1280×800——`store/screenshots/` 现有的三张正好符合，`04-promo-tile.png`（440×280）是 Chrome 专用促销图块，Edge 不需要。

### 1.11 其他命令

```bash
npm run typecheck   # vue-tsc 类型检查
npm test            # Vitest 单元测试
npm run lint        # ESLint
npm run icons       # 从 design/icons 同步扩展图标到 public/icons（16/32/48/128）
npm run release     # 出正式版：校验版本 → 构建 → 打包 zip 到 release/
npm run share       # 出「发给别人」的分享包：扩展 + START-HERE.html（用现有 dist，不重新构建）
npm run dev         # Vite + CRXJS 开发模式，产物同样输出到 dist/ 并支持 HMR
```

---

## 2. 目录结构

```
src/
├─ manifest.config.ts        # Manifest V3 定义（类型化）
├─ background/               # Service Worker：消息路由与依赖装配
│  ├─ index.ts               # 入口：注册监听、装配仓储与 handler
│  ├─ router.ts              # 协议校验 + 错误信封封装
│  ├─ subtitle-service.ts    # 字幕编排：主通道 + 页面通道补位
│  ├─ summary-service.ts     # 总结任务编排：快照持久化、断点续跑、SW 回收兜底
│  ├─ frame-service.ts       # 画面识别编排：帧批次消费、讲稿落盘、按时间点断点去重
│  ├─ tab-identity.ts        # 标签页身份（优先 sender.tab，回退 tabs.get）
│  ├─ page-context.ts        # 向 Content Script 请求页面上下文（带超时）
│  ├─ transports/            # 取数通道：Service Worker fetch / Content Script 同源 fetch
│  └─ handlers/              # system / settings / video / tab / subtitle / ai / summary / frames
├─ content/                  # Content Script：页面入口 + 上下文 + 白名单内同源取数
│  ├─ index.ts
│  ├─ banner.ts              # Shadow DOM 注入的「AI 总结视频」按钮与就地展开面板
│  ├─ frame-capture.ts       # 对页面 <video> 抽帧：暂停恢复、逐点 seek、灰度签名、JPEG 编码
│  └─ page-context.ts        # DOM 读取与标题/时长解析
├─ panel/                    # 就地展开区域内的面板页面（被 iframe 嵌入，需 web_accessible_resources）
├─ core/                     # 与浏览器解耦的领域层（可单测）
│  ├─ bilibili/              # B 站接口封装、URL 白名单、最小响应类型
│  ├─ ai/                    # AiProvider 接口 + OpenAI 兼容实现 + 视觉 Provider + 共享 chat-client
│  ├─ export/                # 导出领域：Markdown 序列化、幕布大纲、字幕 txt、文件名规范化（纯函数）
│  ├─ frames/                # 抽帧领域：类型与参数、采样/帧差纯逻辑、画面讲稿提示词与解析
│  ├─ summary/               # 分块规划、提示词、输出解析、并发编排
│  ├─ subtitle/              # 字幕领域：类型、时间戳、解析、规范化、Provider、文件读取
│  ├─ config/                # 应用常量、默认设置、能力路线图
│  ├─ errors/                # 统一错误码、AppError、错误信封
│  ├─ messaging/             # 消息契约（请求/响应类型）与客户端
│  ├─ settings/              # 设置模型、规范化、域名授权策略
│  ├─ storage/               # 存储抽象、设置仓储、字幕仓储
│  ├─ video/                 # 视频领域模型、B 站链接解析
│  └─ utils/                 # 超时、格式化
├─ popup/                    # Popup UI（Vue 3 + Element Plus）
│  └─ components/            # 视频卡片、模型卡片、字幕卡片、能力进度
├─ options/                  # 设置页 UI
├─ stores/                   # Pinia：settings / video / subtitle
├─ components/               # 共享组件（品牌标识）
├─ composables/              # useTheme
└─ styles/base.css           # 设计变量 + Element Plus 主题覆盖（含深色）
tests/                       # Vitest 单元测试
scripts/sync-icons.mjs       # 校验尺寸并把 design/icons 的 PNG 同步到 public/icons
design/icons/                # 图标设计稿（SVG + 各尺寸 PNG，16/32 为小尺寸简化版）
```

分层约束：UI 只通过 `messageClient` 发消息；Service Worker 只做路由与装配；业务规则集中在 `core/`；浏览器 API 只出现在 `background/`、`content/`、`core/storage/store.ts` 与 UI 的少量调用点。

---

## 3. 消息契约

扩展页面与 Service Worker 之间的协议定义在 `src/core/messaging/contracts.ts`，失败统一返回错误信封：

```ts
type ResponseEnvelope<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: ErrorCode; message: string; details?: string; retryable: boolean } };
```

| 消息类型 | 请求 | 返回 |
| --- | --- | --- |
| `app.ping` | 无 | `{ version, stage, timestamp }` |
| `video.resolveActive` | 无 | `ready` / `unsupported-page` / `no-active-tab` 可判别联合 |
| `video.resolveFromTab` | 无 | 同上，但以 `sender.tab` 为准（供 Content Script 与面板使用） |
| `tab.whoami` | 无 | `{ tabId, url, title, identity, reason }` |
| `settings.get` | 无 | `{ settings, modelConfigured, visionConfigured }` |
| `settings.update` | `{ patch }` | `{ settings, modelConfigured, visionConfigured, issues }` |
| `settings.reset` | 无 | `{ settings, modelConfigured, visionConfigured }` |
| `subtitle.discover` | `{ tabId }` | `SubtitleDiscovery`（含 `availability` / `tracks` / `cid` / `videoTitle`） |
| `subtitle.fetch` | `{ tabId, trackId }` | `NormalizedSubtitle` |
| `subtitle.import` | `{ tabId, fileName, content }` | `NormalizedSubtitle` |
| `subtitle.getCached` | `{ videoKey }` | `{ subtitle: NormalizedSubtitle \| null }` |
| `subtitle.clear` | `{ videoKey }` | `{ cleared: boolean }`（同时清除该视频的总结与分块缓存） |
| `ai.testConnection` | 无 | `AiTestResult`（`ok` / `model` / `latencyMs` / `message` / `errorCode`） |
| `ai.testVision` | 无 | `AiTestResult`；**真实发送一张测试图片**，用于确认模型接受图片输入 |
| `summary.start` | `{ tabId }` | `SummaryTaskSnapshot`（立即返回，实际执行在后台进行） |
| `summary.get` | `{ videoKey }` | `{ task: SummaryTaskSnapshot \| null }` |
| `summary.cancel` | `{ videoKey }` | `{ cancelled: boolean }` |
| `frames.start` | `{ tabId, force? }` | `SummaryTaskSnapshot`（建任务并通知页面开始抽帧后立即返回） |
| `frames.push` | `{ videoKey, frames, progress }` | `{ accepted, analyzed }`；`accepted=false` 表示页面应停止继续抽帧 |
| `frames.finish` | `{ videoKey, capture, error }` | `{ accepted }`；后台据此落盘讲稿并进入总结 |
| `frames.stop` | `{ tabId, videoKey }` | `{ stopped }`；向页面转 `content.stopFrames`，让 seek 循环立刻退出 |
| `frames.getScript` | `{ videoKey }` | `{ script: FrameScriptDocument \| null }` |
| `frames.clear` | `{ videoKey }` | `{ cleared: boolean }` |
| `export.openMubu` | 无 | `{ opened: boolean }`，由后台 `chrome.tabs.create` 打开幕布工作台 |
| `export.download` | `{ tabId, fileName, text, mime }` | `{ started: boolean }`，转交目标页面顶层文档下载 |

Service Worker → Content Script：

| 消息类型 | 请求 | 返回 |
| --- | --- | --- |
| `content.startFrames` | `{ videoKey, options, skipTimes }` | `{ started: true }` 或 `{ started: false, reason }`；只做同步检查后立即返回。`skipTimes` 是已识别过的时间点，页面侧直接跳过 |
| `content.stopFrames` | `{ videoKey }` | `{ stopped: true }`；置停止标志，seek 循环在下一个候选点退出 |
| `content.download` | `{ fileName, text, mime }` | `{ started: boolean }`；由页面顶层文档创建 Blob 并触发下载 |
| `summary.cancel` | `{ videoKey }` | `{ cancelled: boolean }` |

所有 `subtitle.*` 请求的**视频身份由 Service Worker 从标签页真实 URL 解析**（`chrome.tabs.get(tabId).url`），客户端无法传入伪造的 `bvid`。

Service Worker 收到未知类型返回 `E_UNKNOWN_MESSAGE`，payload 结构错误返回 `E_INVALID_PAYLOAD`；handler 抛出的 `AppError` 会保留错误码与 `retryable` 标记，普通异常收敛为 `E_INTERNAL`。

Content Script 接受三种消息：

- `content.collectPageContext` → `{ title, author, durationSeconds, collectedAt }`
- `content.fetchJson`（`{ url }`）→ `{ ok: true, status, text }` / `{ ok: false, message }`，仅接受 **GET** 且 URL 必须命中白名单（`api.bilibili.com`、`*.bilibili.com`、`*.hdslb.com`），否则返回「该地址不在允许的 B 站域名范围内」。这是补充取数通道，不是通用代理。
- `content.openPanel` → `{ opened: true, reason: null }` / `{ opened: false, reason: 'not-video-page' \| 'entry-unavailable' \| 'identity-unresolved' }`，供 Popup 展开页面内的面板。
- `content.download`（`{ fileName, text, mime }`）→ `{ started }`。**下载必须由顶层文档发起**：面板是跨源 iframe，浏览器会把它发起的 blob 下载直接取消（实测 `downloadWillBegin` 后立即 `canceled`，文件不落盘），所以这条消息的职责就是把下载搬回页面本身。

### 3.0 为什么页面内入口不需要 activeTab

`activeTab` 只在「用户点击扩展图标」等显式手势后临时授予，且面板是 iframe 嵌入 B 站页面、Content Script 也在页面里，它们发消息时 `sender.tab` **必然可读**。因此：

- 入口横幅与面板走 `tab.whoami` / `video.resolveFromTab`，身份取自 `sender.tab`，扩展不需要 `tabs` 权限，也不需要为 `www.bilibili.com` 申请 host 权限；
- 只有 Popup 走 `video.resolveActive`（依赖 activeTab 读活动标签页）；
- `host_permissions` 仍只覆盖 `api.bilibili.com` 与 `*.hdslb.com`，用于在 Service Worker 内直接取字幕。

---

## 3.1 字幕实现要点（含接口实测结论）

### 取数路径（2026-10 实测，未登录会话）

| 步骤 | 接口 | 是否需要登录 / 签名 | 实测结论 |
| --- | --- | --- | --- |
| 1. 取 cid | `/x/web-interface/view?bvid=` | 否 | 返回 `code: 0`、`pages[].cid`、`title`、`duration` |
| 2. 取轨道 | `/x/player/v2?bvid=&cid=` | 否（**不需要 WBI 签名**） | 返回 `subtitle.subtitles`；未登录时 `need_login_subtitle: true`、`login_mid: 0`、`subtitles: []` |
| 3. 取内容 | `subtitle_url_v2` / `subtitle_url`（`*.hdslb.com`） | 否 | 返回 `{ body: [{ from, to, content }] }` |

因此**字幕轨道与内容强依赖用户自己的浏览器登录态**，扩展不绕过登录或风控。实测中匿名枚举「有字幕的视频」会被排行榜接口以 `-352` 拒绝，所以不做任何匿名探测。

### 双通道取数

1. **主通道**：Service Worker 直接 `fetch`（`credentials: 'include'`），依赖 `host_permissions` 中的 `api.bilibili.com` / `*.hdslb.com` 绕过 CORS。
2. **补位通道**：主通道拿到的轨道为空且 `login_mid === 0` 时，经 Content Script 在视频页内做同源请求，复用页面 Cookie；仍受 URL 白名单限制。

### 缓存与解析

- cid 缓存 10 分钟、发现结果缓存 2 分钟（内存，随 Service Worker 回收失效，不做持久化）。
- 解析器为自研纯函数，未引入三方字幕库：
  - SRT：`HH:MM:SS,mmm --> ...`，兼容 `.` 作毫秒分隔符
  - WebVTT：`WEBVTT` 头、`MM:SS.mmm` 短格式、cue 标识行
  - B 站 JSON：`from` / `to` 为**秒**（浮点），兼容通用 `cues`（毫秒）与 `startMs` / `endMs`
  - 格式判定**内容优先、扩展名兜底**（`.txt` 里的 `WEBVTT` 会被识别为 VTT）
- 文本清理：剥离 HTML 标签、ASS override（`{\an8}`）、解码 HTML 实体；按起始时间稳定排序并重新编号。
- 规范化统计：`endMs <= startMs` 修正为 `+1000ms` 并计入 `repairedCues`；空文本丢弃并计入 `droppedCues`。
- 持久化：`chrome.storage.local` 的 `subtitle/v1/<videoKey>`，单条上限 4 MB，读取时做结构校验，损坏即清除并返回 `null`。
- 文件导入编码回退：先按 UTF-8 解码，出现 U+FFFD 时回退 GBK 并取替换字符更少的结果。

> 时间戳始终来自真实字幕条目，`SubtitleCue.startMs` 直接对应原字幕的 `from` / SRT 时间行，不做任何重排或猜测。

---

## 4. 设置项与默认值

默认值集中在 `src/core/config/defaults.ts`，取值范围由 `SETTINGS_LIMITS` 统一约束，界面控件与规范化逻辑共用同一份定义。

| 分区 | 字段 | 默认值 | 范围 |
| --- | --- | --- | --- |
| 模型 | baseUrl | `https://api.openai.com/v1` | http/https |
| 模型 | apiKey | 空 | 仅本地存储 |
| 模型 | model | `gpt-4o-mini` | 非空 |
| 模型 | temperature | 0.3 | 0 ~ 2 |
| 模型 | maxOutputTokens | 3000 | 256 ~ 32000 |
| 模型 | timeoutMs | 120000 | 5000 ~ 300000 |
| 视觉模型 | baseUrl | 空（沿用主模型） | http/https |
| 视觉模型 | apiKey | 空（沿用主模型） | 仅本地存储 |
| 视觉模型 | model | 空（= 未启用画面识别） | 支持图片输入的模型名 |
| 分块 | targetTokens | 6000 | 500 ~ 60000 |
| 分块 | maxTokens | 8000 | 1000 ~ 64000 |
| 分块 | overlapSeconds | 30 | 0 ~ 120 |
| 分块 | concurrency | 2 | 1 ~ 6 |
| 分块 | maxRetries | 3 | 0 ~ 6 |
| 抽帧 | sampleFps | 2（密集采样） | 0.5 ~ 4 |
| 抽帧 | minGapSeconds | 3 | 1 ~ 60 |
| 抽帧 | maxFrames | 200 | 20 ~ 600 |
| 抽帧 | imageWidth | 512 | 256 ~ 1280 |
| 界面 | theme | auto | auto / light / dark |

所有读写在 `SettingsRepository` 中经过 `normalizeSettings` 收敛：越界值夹紧、非法 Base URL 清空、`targetTokens > maxTokens` 自动收敛、保留帧间隔小于采样周期时按采样周期收敛，并把被修正的字段以 `issues` 返回给界面展示。

**视觉模型为什么要单独一段**：文本模型不一定接受图片输入。把画面识别混在 `model` 里，用户会在不知情的情况下把图片发到不支持的模型上，然后在抽帧几十秒后才收到一条看不懂的接口报错。因此 `vision.baseUrl` / `vision.apiKey` 留空即沿用主模型，`vision.model` 为空即视为未启用——此时面板**不渲染**画面识别按钮，不生成无功能的入口。设置页的「测试图片能力」会真实发送一张图片，直接确认该模型能不能看图。

**设置页面向普通用户的措辞**：`temperature` / `maxOutputTokens` / `timeoutMs` 三项在界面上不暴露字段名，改为「回答灵活程度」「单次回答长度上限」「等待回复的最长时间（秒）」，每项下方有一句读数把数值翻译成人话（`0.3 偏稳定：更贴近原话，多次结果接近`、`约 3,000 字，超出会被截断`、`约 2 分钟，超时会报错`）。超时在界面按**秒**呈现，存储仍是毫秒，换算只发生在控件与读数处，不动已落盘的配置；`normalizeSettings` 的越界提示也跟随界面量纲，显示「低于下限 5 秒」而不是 5000。三项被圈成一个带边框的分组，右上角「恢复推荐值」一键回到上表默认值，已是默认值时按钮自动禁用。

**分块与抽帧也同样改了措辞**。这两组原本直接暴露引擎字段（目标块大小 / 并发数 / 采样频率 / 保留帧最小间隔），用户看不出「6000 和 8000 差在哪」。现在：

| 原字段 | 界面标签 | 读数（默认值下） |
| --- | --- | --- |
| `chunk.targetTokens` | 每段内容量 | 约 6,000 字 · 约 24 分钟口播 |
| `chunk.maxTokens` | 单段上限 | 再长也不超过 8,000 字 |
| `chunk.overlapSeconds` | 相邻段重复（秒） | 相邻两段重复 30 秒 |
| `chunk.concurrency` | 同时处理几段 | 同时向模型发 2 个请求 |
| `chunk.maxRetries` | 失败重试次数 | 失败最多重试 3 次 |
| `frames.sampleFps` | 抽帧密度（每秒几帧） | 每秒取 2 帧当候选 |
| `frames.minGapSeconds` | 两张图的间隔（秒） | 至少隔 3 秒留一张 |
| `frames.maxFrames` | 最多看几张图 | 最多保留 200 张 |
| `frames.imageWidth` | 图片宽度（像素） | 宽 512 像素 |

token → 字数的换算口径是**「1 个汉字约 1 token」**（与 `summary-chunk` 的估算一致），分钟数按 **250 字/分钟**的口播语速粗估，只用于给出量级参照，不影响实际切分。参数本身没有被改写，`SETTINGS_LIMITS` 仍是唯一约束来源。两个分区的「恢复推荐值」放在**分区标题右侧**（`SettingsSection` 的 `extra` 插槽），不额外加一层边框——这里整块都是参数，再套一个框会变成「框里套框」。原「长视频分块」标题旁的「阶段 4 生效」标签已移除：该能力已经生效，留着一个阶段号只会让人以为还要等。

旧版本存储（无 `vision` / `frames` 段）读取时会自动补齐默认值，`schemaVersion` 升到 2，不需要手动重置。

---

## 5. 权限说明

| 权限 | 用途 | 说明 |
| --- | --- | --- |
| `storage` | 保存设置、字幕缓存、后续的任务与历史 | 使用 `storage.local`，API Key 不参与账号同步 |
| `activeTab` | 点击图标后读取当前标签页地址以识别视频 | 不使用 `tabs` 通配权限 |
| `host_permissions`（`https://api.bilibili.com/*`、`https://*.hdslb.com/*`） | 在 Service Worker 中直接请求 B 站字幕接口与字幕文件 | 仅这两个域，安装时授予；用于绕过 CORS 以携带用户 Cookie |
| `content_scripts`（`https://www.bilibili.com/video/*`） | 采集页面上下文、白名单内的同源补位请求、注入页面内入口、对页面 `<video>` 抽帧 | 只在视频播放页注入；抽帧只在用户点击「按画面识别生成总结」后执行 |
| `web_accessible_resources`（`src/panel/index.html`，匹配 `https://www.bilibili.com/*`） | 让页面内的展开区域能以 iframe 加载面板页面 | `matches` 必须是**宿主级通配**；写成 `/video/*` 会被 Chrome 判为 `Invalid match pattern` 并拒绝加载整个扩展 |
| `optional_host_permissions`（`https://*/*`、`http://*/*`） | 自定义模型域名 | **安装时未授予**，由用户在设置页按 origin 显式授权 |

未申请 `cookies`、`webRequest`、`debugger`、`tabs`、`history` 等权限；未使用远程 JavaScript；页面脚本读取不到信息时返回 `null` 而不是猜测。

**画面识别没有新增任何权限**。抽帧在 Content Script 内用 canvas 完成（实测 B 站视频不会被跨域污染，见 1.7），因此不需要 `tabCapture`（那个权限还会要求用户手势、并在标签页上显示共享指示条）。抽出的静帧只经消息通道送到 Service Worker，再发给用户自己配置的视觉模型，不落盘、不上传到任何第三方。

**导出也没有新增任何权限**。没有用 `downloads`：下载通过 `content.download` 交给页面顶层文档执行（跨源 iframe 里发起会被浏览器取消，见 1.8）；打开幕布用的是 `chrome.tabs.create`，该方法不需要 `tabs` 权限。剪贴板写入用的是页面自身的 Clipboard API / `execCommand`，不涉及额外权限。

> `host_permissions` 只用于 `fetch`，扩展**不读取、不导出、不上传**任何 Cookie。请求由用户主动点击「获取字幕」触发，扩展没有后台轮询或定时请求。

---

## 6. 已实现行为的验证记录

| 验证项 | 方式 | 结果 |
| --- | --- | --- |
| 类型检查 | `npm run typecheck`（vue-tsc，strict + noUncheckedIndexedAccess） | 通过，0 错误 |
| 单元测试 | `npm test`（Vitest） | 20 个文件 / 255 个用例全部通过（含抽帧采样、画面讲稿解析与兜底对齐、画面识别编排与空跑防护、Markdown / 幕布 / 字幕导出、思维导图建树与布局、章节覆盖度与补问、版本与 manifest 简介一致性） |
| ESLint | `npm run lint` | 0 问题 |
| 生产构建 | `npm run build` | 通过，产出 `dist/`（含 `manifest.json`、`service-worker-loader.js`、popup / options / panel 三个 HTML 入口） |
| 扩展可加载 | 以 `--load-extension=dist` 启动 Chromium 156，检查 CDP 目标列表 | Service Worker、Options 页、Content Script 与面板 iframe 均正常启动，`app.ping` 返回 `{"version":"1.0.2"}` |
| manifest 合法性 | `--pack-extension=dist` 打包 | 打包成功。早期 WAR 的 `matches` 写成 `/video/*` 时报 `Invalid match pattern` 并导致扩展拒绝加载，改为宿主级通配后修复 |
| 消息与存储 | 在真实扩展环境调用 `settings.update` → `settings.get` | `modelConfigured` 由 false 变为 true，`updatedAt` 写入成功；未知消息返回 `E_UNKNOWN_MESSAGE` |
| 页面脚本 | 在真实 B 站视频页（BV1GJ411x7h7）调用 `content.collectPageContext` | 返回标题「【官方 MV】Never Gonna Give You Up - Rick Astley」、UP 主「索尼音乐中国」、时长 213 秒，标题后缀已清理 |
| 字幕发现（登录受限） | 真实浏览器 + 真实接口调用 `subtitle.discover`（BV1GJ411x7h7） | 返回 `availability: 'login-required'`、真实 `cid: 137649199`、真实标题；与直接请求 `player/v2` 的 `need_login_subtitle: true` 一致 |
| 字幕发现（无字幕） | 同上（BV1xx411c7mD，`need_login_subtitle: false`） | 返回 `availability: 'empty'`、`cid: 62131`、`loginRequired: false`，提示可导入本地字幕 |
| 字幕导入 | 在真实扩展环境提交 SRT 文本调用 `subtitle.import` | 3 条解析正确，`<i>` 与 `{\an8}` 被剥离、`&amp;` 解码为 `&`，时间戳精确到毫秒 |
| 格式识别 | 把 VTT 内容以 `note.txt` 文件名导入 | 内容优先识别为 `vtt`，标签为「导入字幕（VTT）」 |
| 缓存读写与清除 | `subtitle.import` → `subtitle.getCached` → `subtitle.clear` → `subtitle.getCached` | 键为 `subtitle/v1/BV1xx411c7mD#p1`，读回 3 条、清除后返回 `null` |
| 错误路径 | 空内容 / 无意义内容 / 非 B 站页 / 不存在的 tabId / 负数 tabId | 分别返回 `E_INVALID_PAYLOAD`、`E_SUBTITLE_PARSE_FAILED`、`E_NOT_BILIBILI_PAGE`、`E_NO_ACTIVE_TAB`、`E_INVALID_PAYLOAD`，均为结构化中文错误 |
| 内容脚本补位通道 | `content.fetchJson` 请求真实 `view` 接口 | HTTP 200、1686 字节、`code: 0`、`cid` 正确 |
| 内容脚本白名单 | `content.fetchJson` 请求 `https://evil.example.com/...` | 被拒绝，返回「该地址不在允许的 B 站域名范围内」 |
| 权限精确性（正向） | Service Worker 内 `fetch('https://i1.hdslb.com/...jpg')` | HTTP 200、651508 字节、`image/jpeg`，证明 `host_permissions` 生效 |
| 权限精确性（反向） | Service Worker 内 `fetch('https://example.com/')` | `TypeError: Failed to fetch`，证明未授予的域不会被意外放行 |
| 页面内入口注入 | 真实 B 站视频页，读取宿主节点 | 入口插在 `.up-panel-container` 之后，`rect {top:176,left:714,w:350,h:55}`，文本「✦ AI 总结视频 / 字幕摘要 · 章节定位 ›」，不遮挡原有内容 |
| 就地展开 | 点击入口按钮后读取 Shadow DOM | `data-open="true"`、`aria-expanded="true"`，展开区 `rect {w:350}` 与右侧栏同宽，高度按视口计算（`min(640, innerHeight-150)`）；`iframe.src = chrome-extension://.../src/panel/index.html?tabId=...&videoKey=BV1GJ411x7h7%23p1`。再次点击后高度归 0、`aria-expanded="false"` |
| 展开不遮挡内容 | 对比展开前后的右侧栏 | 面板在文档流内向下推挤后续内容，播放器与评论区位置不变；收起后高度归 0 不残留空白 |
| 后台标签页展开 | 标签页未激活时点击入口（模拟 Popup 打开后台标签） | 后台不推进 CSS 过渡，已做兜底：高度立即生效（实测 440px，视口 590px），不会停在 0 |
| 面板身份（免 activeTab） | 面板内读取渲染结果 | 显示真实标题「【官方 MV】Never Gonna Give You Up - Rick Astley」与真实 UP 主「索尼音乐中国」，证明 `sender.tab` 路径可用 |
| 面板字幕降级 | 面板内点击「获取字幕」 | 显示「该视频的字幕仅登录后可见，请先在浏览器中登录 B 站账号，再重新获取」，与后端 `availability: 'login-required'` 一致 |
| 面板字幕导入 | 面板内以真实 `File` + `change` 事件导入 5 条 SRT | 界面变为「已获取 5 条 · 24 秒 · 本地导入」，预览显示 `00:01`、`00:04`、`00:09` 三条带时间戳字幕，`<i>` 被剥离、`&amp;` 解码 |
| 总结前置校验 | 导入字幕后点击「开始总结」（未配置模型） | 界面显示后端真实返回的「请先在设置页填写 Base URL、API Key 与模型名称」，错误码 `E_SETTINGS_INVALID` |
| 设置页测试连接 | 未配置时点击「测试连接」 | 结果块显示「连接失败 / 请先填写 Base URL、API Key 与模型名称并保存 / 耗时 1 ms · 错误码 E_SETTINGS_INVALID」 |
| 测试连接拦截未保存修改 | 修改 API Key 后直接点「测试连接」 | 弹出「有未保存的修改。连接测试使用已保存的设置，请先点击底部「保存设置」」，且**不发请求** |
| Popup 打开面板通道 | 从 Service Worker 向视频页发 `content.openPanel` | 返回 `{opened:true, reason:null}`，面板被展开，证明 Popup 的入口按钮链路可用 |
| Popup 渲染 | 真实扩展环境截图（浅色 / 深色 / 未识别 / 已识别 / 登录受限 / 已导入 / 滚动到底） | 无控制台错误；深色下 `--el-color-primary` 仍为 `#fb7299`，`body` 背景 `rgb(20,22,26)`；底部按钮为「打开页面侧边面板」，未在视频页时禁用 |
| 权限受限路径 | 不授予 `tabs` 时调用 `subtitle.discover` | 返回 `E_NOT_BILIBILI_PAGE`，不崩溃、不挂起 |
| canvas 可读性探针 | 真实 B 站视频页：`play()` 后等 `readyState>=2 && videoWidth>0`，再 `drawImage` + `toDataURL` + `getImageData` | 未抛 `SecurityError`；`nonBlackRatio 0.725`、`avgLuma 103`、`distinctColors 39`，证明读到真实画面而非空白帧。首次探针因 `readyState: 0`（未解码）得出的结论无效，已重测 |
| 视觉模型连通性 | 设置页「测试图片能力」（`ai.testVision`） | `ok: true`、`qwen3.5-flash`、33566 ms、模型对测试图片返回「红色」，证明该模型接受 `image_url` 输入 |
| 画面识别端到端 | 真实 B 站视频页（BV1GJ411x7h7，无字幕）→ 面板点「按画面识别生成总结」 | 抽帧采样 73 个时间点、保留 63 帧 → 识别出 **70 条画面描述** → 总结 `status: done`、`source: 'frames'`、`chunkCount: 1`、`cueCount: 70`；概述与章节均来自真实画面（如「场景切换至蓝色调拱廊」「吧台场景与多人互动」），章节时间戳 00:00 / 00:06 / 00:35 / 00:56 / 01:17 / 02:17 / 02:41 |
| 讲稿缓存复用 | 同一视频再次点击按钮 | 进度文案直接为「复用已识别的画面讲稿」，**没有出现抽帧阶段**，30 秒完成总结，`cueCount` 仍为 70 |
| 来源标签 | 面板截图 | 结果卡片右上角显示「画面识别」标签；脚注显示「共 1 段 · 70 条画面描述 · 总耗时 … · qwen3.5-flash」 |
| 无视觉模型时的入口 | 未填视觉模型名的配置下面板 | 不渲染画面识别按钮，改为提示「尚未配置视觉模型，画面识别不可用…」并说明去设置页填什么 |
| 画面识别空跑防护 | 在 Service Worker 的 `fetch` 上做 CDP 请求拦截，返回「200 + 空 content」（精确复现 `deepseek-v4-flash` 对带图请求的真实表现） | 第一批 6 帧之后立刻 `status: failed`，错误为「视觉模型「mock-model」看了 6 帧画面，一个字都没有返回——它很可能不支持图片输入…」；**拦截到的带图请求只有 1 次**（修复前会把整段视频的帧全部抽完并逐批识别，最后仍然 0 条）；后续 `frames.push` 返回 `accepted: false`，页面侧停止抽帧 |
| 空跑防护没有伤到正常链路 | 同一拦截改成返回「1 \| …」逐行编号 | 两批各 6 帧均 `accepted: true`，`analyzed` 6 → 12；讲稿落盘 `entries: 12 / complete: true`，首条为 `{ tMs: 0, text: '第 1 帧：夜间骑行…' }`；`frames.finish` 返回 `accepted: true` 并进入总结 |
| `frames.stop` 已注册并能打断 | 从内容脚本上下文发 `frames.stop` | 返回 `{ stopped: true }`；页面脚本未注入或标签页已关闭时同样返回已停止，不抛错 |
| 续跑不重复抽帧 | 单元测试 `withoutKnownTimes` + `FrameService.start` 的返回值 | 讲稿有 0ms / 12000ms 两条时，`start` 返回 `skipTimes: [0, 12000]`；页面侧据此过滤，全部命中时返回空数组——连 seek 与 JPEG 编码都不再做 |
| 无编号输出的兜底解析 | 单元测试 `parseFrameDescriptions` | 「画面一：…」三行正确对齐到三个时间点；只回 1 行却对应多帧时**不做**对齐（避免把整段结论挂到第一帧上） |
| 设置页视觉区 | 配置后截图 | 状态显示「已启用 · 将使用 qwen3.5-flash」，实际请求地址回显 `https://ai.ctaigw.cn/v1`（沿用主模型），域名授权显示「已授权」 |
| 抽帧参数估算提示 | 设置页「画面抽帧」区 | 按当前配置显示「最多采样约 400 个时间点、保留不超过 200 帧…预计 32 秒」，与采样器预算公式一致 |
| 导出按钮渲染 | 面板结果区截图 | 脚注下方并排出现「下载 .md」「复制到幕布」，点击后提示区显示绿色结果，无控制台错误 |
| Markdown 导出内容 | 真实浏览器点击「下载 .md」，监听 `Browser.downloadWillBegin` / `downloadProgress` | 浏览器收到下载，建议文件名 `【官方 MV】Never Gonna Give You Up - Rick Astley-AI总结.md` 与预期**完全一致**；`totalBytes` **941** 与用同一份输入在 Node 侧算出的 Markdown 字节数 **941 完全相同**，证明面板 → 后台 → 内容脚本 → 顶层文档这条链路搬运的内容无误 |
| 幕布大纲内容 | 点击「复制到幕布」后从顶层页面 `navigator.clipboard.readText()` 读回 | 内容与预期大纲**逐字一致**，唯一差异是 Windows 剪贴板把 `\n` 规范成 `\r\n`（系统行为）；Tab 缩进层级完整保留（一级 1 个、二级 2 个、三级 3 个） |
| 幕布标签页 | 点击后检查 CDP 目标列表 | 新标签页打开 `https://mubu.com/app`（未登录时重定向到 `mubu.com/login?next=/app`，属幕布自身行为） |
| 下载被 iframe 取消 | 在面板 iframe 内直接 `Blob + a[download]`，监听下载事件 | `downloadWillBegin` 后立即 `canceled`、文件不落盘；改由顶层文档发起后文件名与字节数均正确。**这是这次实现必须绕开的真实限制，不是推测** |
| 剪贴板降级 | 面板内拦截 `navigator.clipboard.writeText` | 无头环境下抛 `NotAllowedError`（跨源 iframe + 焦点），自动退回 `execCommand` 并成功写入；界面文案「大纲已复制…」与实际一致 |
| 字幕展开全文 | 导入 120 条 SRT 后读取面板 DOM | 收起态 3 条、展开后 **120 条**；容器 `clientHeight 260 / scrollHeight 3202` 即真实可滚动；按钮文案切换为「收起字幕」，时间戳渲染为可点击按钮 |
| 字幕导出 txt | 点「下载 .txt」，监听下载事件并用缓存中的真实字幕算出预期内容 | 文件名 `【官方 MV】…-字幕.txt` 与预期一致；`totalBytes` **8236** 与 Node 侧算出的字节数 **8236** 完全相同（含 UTF-8 BOM） |
| 章节覆盖提示 | 写入一份「章节最晚到 00:00、素材到 24:34」的快照 | 脚注下方渲染「章节只覆盖到 00:00，素材一直到 24:34」，与判定逻辑一致 |
| 单块直出与补问 | Vitest（`summary-coverage.test.ts`，11 用例） | 单块只发 1 次请求且消息里是原始 `[mm:ss]` 字幕（不是「各段落摘要」）；覆盖不足补问 1 次且第二次带「只覆盖到 00:00 / 24:59」指令；补问失败保留第一份结果；短视频不补问 |
| 入口按钮配色 | 真实 B 站视频页，读 shadow DOM 的 `getComputedStyle` + `CSS.forcePseudoState(['hover'])` | 默认边框 `rgb(227,229,231)`（中性灰，与侧栏原生按钮一致）；强制 hover 后边框 `rgb(251,114,153)` 即 `#fb7299`、背景 `rgb(255,250,252)`；图标块底色 `rgb(255,241,245)`；SVG `fill` 为 `#FB7299`；CSS 文本中已无 `e4472b` |
| 品牌标识配色 | 真实扩展页面（popup / options）读 `.brand-mark` 及其子节点样式 | 两页 `svg.color`、`svg.fill`、三角形 `stroke`、三条横线 `fill` **全部为 `rgb(251,114,153)`**；`--app-accent` 计算值为 `#fb7299`（证明色值来自变量而非硬编码）；页面内不存在 `rgb(228,71,43)` 残留 |
| 面板身份不受其他标签页影响 | 同时打开两个 B 站视频标签页，把另一个切到前台后在当前页展开面板 | 面板渲染的标题/UP 主仍是**本页视频**（`sender.tab.url` 可用，不会回退到 `active:true` 查询），`videoKey` 与本页 URL 一致 |
| 分 P 切换跟随 | 打开多分P视频 `?p=1`，展开面板，再 `pushState` 到 `?p=2` | 1 秒内 `iframe` 的 `videoKey` 由 `#p1` 变为 `#p2`，面板内容随之切换为第二分P的数据，未出现跨分P残留 |
| 跨视频键隔离 | 预置两份不同 videoKey 的快照与字幕，再逐个切换分P | 每次都只读到当前键对应的那一份，`summary.get` 返回值与请求键严格一致 |
| 素材指纹落盘 | 预置含 `material` 的快照后读面板 DOM | 脚注下方渲染「依据 3 条字幕 · 00:00–00:08 · 首条「这是第一条字幕原文」」，与快照里的 `material` 字段逐项一致 |
| 错配快照拦截 | 把一份 `videoKey` 与存储键不一致的快照写入存储，再打开该键的面板 | 结果区**不渲染**（`hasResult: false`），改为提示「这份总结记录的视频是 BV1WRONGv1d#p9，与当前视频 BV1p8nh61Efm#p2 不一致，已隐藏以免误读」 |
| 素材核对：首句对不上 | 字幕写动漫台词、结果的 `material.firstText` 写汽车台词，其余字段（含 `videoKey`）全部合法 | 结果区顶部出现**红色**告警：「这份总结依据的首句「今天我们来试驾这台全新的新能源轿车」在当前字幕里找不到，素材很可能已经换成别的视频的字幕」，右侧带「改用平台字幕」链接；下方追加处置建议。**结果仍然渲染**（不隐藏已生成的内容，只把风险摆在最前面） |
| 素材核对：本地导入来源 | 把字幕文档的 `source` 改成 `import`、`importedFileName` 填「某部汽车评测.srt」 | 出现**中性灰**提示「素材来自本地导入文件「某部汽车评测.srt」，不是 B 站字幕——请确认它确实是这个视频的字幕」；级别是 `info` 而非 `error`（导入本身是正常选择，不该渲染成故障） |
| 素材核对：时长冲突 | 字幕 `totalDurationMs` 设为 47 分钟，视频实际 03:30 | 出现红色告警「字幕总长 47:00 超过视频时长 03:30，这份字幕不可能是当前视频的」；同一用例里首句是匹配的，证明三重核对各自独立生效 |
| 素材核对：不叠加噪音 | 同时构造「首句对不上」+「时长溢出 47 分钟」 | 只报 `text-not-found` 一条，不再叠加时长告警——结论相同，多两行红字只会降低可读性 |
| 素材核对：PV 类视频不误报 | Vitest：3.5 分钟视频只有 8 秒对白 | 不产生 `duration-partial`；门槛是「视频 ≥ 5 分钟且字幕覆盖 < 30%」，避免画面向视频被误判成素材不全 |
| 素材核对：正常路径零告警 | 首句一致、条数差 5%（重取字幕）、时长匹配 | `checkMaterialConsistency` 返回空数组，界面不出现任何核对区块 |
| 素材核对落位 | 读面板 DOM 的 `.checks__item` 与 `.footnote--material` | 告警块位于**概述之前**（先判断能不能信，再读内容）；脚注变为「素材 B 站字幕「中文（自动生成）」 · 依据 3 条字幕 · 00:00–00:08 · 首条「…」」，来源与「依据」同一行 |
| 字幕覆盖不足提示 | 在真实 24 分 34 秒视频（BV1PznU6YEZE）上写入「1 条 / 10 秒」字幕夹具后读面板 DOM | 字幕卡片出现琥珀色提示「这条字幕只有 1 条，而这个视频有 24:34。如果视频本身有别的字幕轨道，换一条再试；也可能是 UP 主上传了占位字幕。」，下方是「重新读取轨道并自动挑选」按钮；换成 640 条 / 24 分钟字幕夹具后提示消失 |
| 字幕卡片显示轨道名 | 同上 | meta 行由「1 条 · 10 秒 · B 站」变为「1 条 · 10 秒 · 中文（自动生成）」，轨道名直接可见 |
| 轨道选择器排版 | 临时注入 3 条假轨道后截图（探针已删除，仓库里搜不到 `probeTracks`） | 350px 面板内渲染为「字幕轨道 3 条」+ 三个 chip：选中项粉底粉字加粗、其余描边；三个 chip 自动换行，无裁切、无溢出 |
| 轨道挑选逻辑 | Vitest（`subtitle-track-choice.test.ts`，14 用例） | 优先中文自动生成而非盲取第一条；无自动生成时退到任意中文；全外语时退回第一条；锁定/空地址轨道被过滤；条数与覆盖率两种判定各自生效 |
| 分 P 不存在不再回落 | Vitest（`subtitle-provider.test.ts`） | `?p=5` 但视频只有 2 个分P 时抛 `E_SUBTITLE_UNAVAILABLE`（「没有第 5 个分P」），且**不发起任何 player 请求**；`pages` 缺失的单P视频才用顶层 `cid` 兜底 |
| 视觉模型真实能力 | 直接向同一网关发一张 32×32 纯红 PNG，比对两个模型返回的 `content` | `deepseek-v4-flash`：HTTP **200** 但 `content` 为**空字符串**（1484 ms）；`qwen3.5-flash`：`content` 为「**红色**」（1687 ms）。证明「接口 200」不等于「模型看了图」 |
| 视觉测试三档判定 | Vitest（`vision-test-result.test.ts`，3 用例） | 空内容 → `ok: true` 且 `imageAccepted: false`，文案含「不支持图片输入」并**不再出现**「图片输入可用」；正常回答 → `imageAccepted: true`；环境无 `OffscreenCanvas` → `imageAccepted: undefined` 且文案含「未验证图片输入能力」 |
| 参数三项通俗化 | 真实设置页（CDP 发真实鼠标/键盘事件，不用 `element.click()`） | 初始读数「0.3 偏稳定…」「约 3,000 字，超出会被截断」「约 2 分钟，超时会报错」；把超时改成 60 后读数立刻变「约 1 分钟」 |
| 恢复推荐值同步刷新 | 同上：键盘录入 60 并回车 → 真实鼠标点击「恢复推荐值」 | 输入框显示值 `60 → 120`（不再停在旧值），读数回到「约 2 分钟」，「恢复推荐值」变为 `disabled`；随「保存设置」落盘 `timeoutMs: 120000` |
| 分组与相邻区块不粘连 | 读 `.field-group` 与 `.permission-row` 的 `getBoundingClientRect` | 修复前两者 `bottom === top === 556`（两条圆角边框贴死，视觉上像一个框）；加 `margin-bottom: 14px` 后分离 |
| 深色主题下的分组 | 强制 `html.dark` 后读计算样式并截图 | 分组背景 `rgb(27,30,36)`、边框 `rgb(54,54,55)`、正文 `rgb(232,234,237)`，层级可辨、文字可读 |
| 分块 / 抽帧通俗化 | 真实设置页读 DOM（CDP 真实键鼠事件） | 9 个字段全部渲染为新标签与读数：`约 6,000 字 · 约 24 分钟口播`、`再长也不超过 8,000 字`、`每秒取 2 帧当候选`…；两者「恢复推荐值」初始为 `disabled` |
| 分块读数联动 | 键入「每段内容量」2000 | 读数立刻变 `约 2,000 字 · 约 8 分钟口播`，「恢复推荐值」转为可点 |
| 分块恢复推荐值 | 真实鼠标点「恢复推荐值」 | 五个输入框全部刷新为 `6000 / 8000 / 30 / 2 / 3`（未停在手输的 2000），读数同步回默认，按钮复归 `disabled` |
| 抽帧读数与开销联动 | 键入「最多看几张图」60 | 读数变 `最多保留 60 张`，下方开销提示同步变「最多取 **120** 个候选时间点、保留不超过 **60** 张…预计 **10** 秒」（200 张时为 400 点 / 32 秒），证明两个 hint 是随配置实时算的 |
| 抽帧恢复推荐值 | 真实鼠标点「恢复推荐值」 | 四个输入框回到 `2 / 3 / 200 / 512`，按钮复归 `disabled` |
| 交叉约束的提示文案 | 设「每段内容量」20000、「单段上限」4000 后保存 | 出现一条 `每段内容量超过单段上限，已按上限收敛`，保存后输入框显示 `4000`、落盘 `targetTokens: 4000 / maxTokens: 4000` |
| 发布包结构完整性 | 用系统解压工具还原 `release/*.zip`，与 `dist/` 逐文件比对 | 28 个文件，文件名与字节数**逐项一致**（证明自写的 ZIP 写入器没写坏目录项） |
| 发布包安装冒烟 | 用无头 Edge `--load-extension` 直接加载解压后的目录（全新 profile），读设置页与 Popup 的 DOM、manifest，并从设置页发起 `app.ping` | 设置页标题「B站 AI 视频总结 · 设置」、副标题「模型服务、长视频分块与界面偏好」、徽标 `v1.0.2`、三步指引三条齐全、六个分组；Popup 副标题 `v1.0.2`、功能状态 9 项「已支持」+ 1 项「暂未支持」；`app.ping` 返回 `{"ok":true,"data":{"version":"1.0.2",…}}`（已无 `stage` 字段）；两页 console **0 错误**、正文均无「开发阶段 / 阶段 N」 |
| 发布包面板页可运行 | 直接打开 `chrome-extension://<id>/src/panel/index.html`，采集 Vue 挂载状态、样式表规则数与 Network 结果 | Vue 挂载成功、`.panel` 存在、样式表 **79 条规则**（CSS 确实进了包）、Network 无 4xx / `loadingFailed`、console **0 错误**；无 B 站上下文时降级为「当前标签页不是 B 站视频播放页」而非白屏或抛错 |
| 分享包可直接交付 | `unzip` 还原 `release/*-share.zip`，比对文件哈希与结构，再把解压目录交给 Edge 加载 | 根目录 6 项（`manifest.json` / `assets` / `icons` / `src` / `service-worker-loader.js` / `START-HERE.html`），共 29 个文件；28 个扩展文件与 `dist/` **逐个 sha256 一致**；多出的说明页不影响加载，Edge 成功注册扩展；说明页 `{{VERSION}}` 已替换为 `1.0.2`、宽 900px 无横向溢出 |
| 发布包无开发残留 | 对解压目录做字符串扫描 | 无 `localhost:端口` / `127.0.0.1:端口`、无 `TODO` / `FIXME` / `mock-`、无 `.map`；`思维导图` 出现在面板与导出 chunk 中、`svgToPngBase64` / `toDataURL` 均存在，说明知识点与 SVG/PNG 导出链路**真的打进了包**，不是只在源码里 |
| Edge 真实页面注入 | 无头 Edge 156 打开真实视频页（`BV1GJ411x7h7`），轮询 `#bili-ai-summary-host` 是否出现 | **2.0 秒完成注入**（脚本给了 25 秒上限，没用上）；宿主带 Shadow DOM，入口按钮量到 350×42，文字「AI 总结视频 ›」，`aria-expanded="false"`，且视频元素已就绪（640×360） |
| Edge 真实页面打开面板 | 同一页面上用 CDP 发真实鼠标事件点入口，再从目标列表连进面板进程读 DOM | `aria-expanded` 变 `true`；iframe `src` 为 `chrome-extension://<id>/src/panel/index.html?tabId=25463639&videoKey=BV1GJ411x7h7%23p1`，尺寸 348×638；面板已挂载，识别出「【官方 MV】Never Gonna Give You Up - Rick Astley / UP 主：索尼音乐中国 / 时长 3:33」，字幕如实显示「未获取」（未登录） |
| 评论区不被破坏 | 同一视频页，装/不装扩展各重载 3 次，统计 `bili-comments` 是否被创建 | **修复前**：装扩展 3/3 次无 `bili-comments`、`#commentapp` 为空、页面多 1 条 Vue 的 `HierarchyRequestError`；不装 3/3 次都正常。**修复后**：3/3 次 `bili-comments` 存在、异常 0 条 |
| Edge 页面异常归属 | 逐条抓 `Runtime.exceptionThrown` 的脚本 URL 与调用栈，判断是否来自扩展 | 页面自身抛 1 条 `HierarchyRequestError`，来源 `s1.hdslb.com/bfs/static/jinkela/video/video.*.js`，`fromExtension: false`；**扩展侧 0 异常**。这条不做归属分析很容易被误记成「Edge 上插件报错」 |
| 思维导图渲染 | 向真实扩展注入一份含 4 个知识点、4 个章节（部分章节带要点）的快照，打开面板读取 `<img>` 的 dataURL 并解码 | SVG 632×577、17 个节点；文字来自结果本身（根节点是快照里的视频名、《为什么要分块》、时间点 `00:35`、脚注「字幕」，无一条是写死的示例文案） |
| 导图预览倍率 | 点「放大到原始大小」→ 再点「缩小到适配宽度」，量 `img` 与容器的实际宽度 | 适配宽度 352px（容器 352px，无横向滚动）→ 原始大小 632px（容器 352px，`scrollWidth 632`，可横向滚动）→ 切回 352px，与首次完全一致 |
| 导出 SVG（真实落盘） | 点「下载 .svg」，用 `Browser.setDownloadBehavior` 指定 `downloadPath`，读磁盘文件 | 文件名 `…-思维导图.svg`，**6643 字节 == 面板内预览所用 SVG 的字节数**，`<svg xmlns=… width="632" height="577"` 开头，UTF-8 可解析 |
| 导出 PNG（真实落盘） | 点「下载 .png」，同一份 SVG 在页面里独立栅格化算出期望值，再读磁盘文件 | 文件名 `…-思维导图.png`，**235235 字节 == 独立栅格化的字节数**，PNG 签名 `89504e470d0a1a0a` 正确，IHDR 声明 **1264×1154**（= 632×577 的 2 倍），且**不是 base64 长度**（313608），证明二进制解码没走错 |
| 导图配色跟随主题 | 用 `Emulation.setEmulatedMedia` 切浅色 / 深色各截一张 | 浅色为白底、粉根节点；深色为 `#1b1e24` 底、浅色文字，节点与连线均可见，没有「深色面板糊一块白图」 |

> 说明：无头环境无法真实点击工具栏图标，因此上表中「字幕发现」与「Popup 渲染」的部分链路验证使用了**临时构建副本 + 后台标签页桩数据**来满足 `activeTab` 的授予条件。正式产物（`dist/`）的权限清单未做任何改动，桩数据只存在于 `.verify/` 验证脚本中。该目录是本地验证工作区（含真实站点的接口抓包、浏览器 profile 与截图），**未纳入版本控制**，因此克隆仓库后看不到它；上表的结论仍然成立，只是复现脚本需要自行按描述搭建。
>
> **仍未验证项**：真实字幕下载（需要登录态）。真实模型调用、章节点击跳转与画面识别端到端已在有效 API Key 下端到端跑通，见上表。
>
> **导出相关的验证边界（已修正早期结论）**：早前记录过「这台机器的无头浏览器无法把任何下载落盘」，实际原因是 `Browser.setDownloadBehavior` 只给了 `behavior` 而没给 `downloadPath`——补上之后，SVG 与 PNG **都能真实写入磁盘**，本轮导图导出就是按「读磁盘文件 + 逐字节比对」验证的（6643 == 6643、235235 == 235235，并解析了 PNG 的 IHDR）。两个仍然成立的注意点：下载总是由**目标标签页的顶层文档**发起（面板只发消息），所以该视频页必须还开着，否则 `export.download` 会返回失败，而不是静默丢弃；`Browser.downloadWillBegin` 事件本身证明不了文件存在，判断「下载成功」应以磁盘文件为准。
>
> **环境注意**：用 `--load-extension` 加载未打包扩展时，Edge 在**复用同一 profile 重启后会停用该扩展**（开发者模式未持久化），表现为内容脚本完全不注入。每次验证都使用全新 profile 目录，不能复用。

---

## 7. 已知限制

1. **视频识别依赖图标点击授予的 `activeTab`。** 若通过开发者工具直接刷新 Popup 页面，`tab.url` 不可读，界面会提示「无法读取当前标签页地址，请关闭本面板后重新点击扩展图标」。`subtitle.*` 请求同样受影响（返回 `E_NOT_BILIBILI_PAGE`）。
2. **入口是浮层，展开时会盖住右栏内容。** 早先的实现在右栏信息栏下方就地插入、把页面内容推开，但那会破坏 B 站页面的 Vue 渲染，导致评论组件挂载失败（装扩展 3/3 次评论区为空，不装 3/3 次正常）。改为挂在 `body` 上固定定位后评论区恢复正常，代价是面板不再参与文档流——展开时浮在右栏之上。如果更在意不遮挡，可以只用 Popup 的「打开页面侧边面板」并在用完后立即关闭。
2. **番剧页面不支持。** `bangumi/play/ep*`、`ss*` 能解析出编号，但页面结构与普通投稿不同，Popup 会明确提示暂不支持；字幕获取也会拒绝（`E_UNSUPPORTED_PAGE`）。
3. **字幕强依赖登录态，且无法匿名验证。** 未登录时多数视频的 `subtitles` 为空且 `need_login_subtitle: true`，此时扩展只能提示登录，不会尝试任何绕过手段。匿名枚举「有字幕的视频」会被 `-352` 风控拒绝，因此不做自动探测。
4. **`subtitle.fetch` 的真实下载路径未被点通。** 验证环境中的浏览器未登录 B 站。对热门榜前 20 个视频逐个请求 `player/v2` 的结果是 **全部 `tracks=0`**（14 个 `need_login_subtitle: true`、6 个 `false`），因此拿不到真实的 `subtitle_url`。「下载 + 解析 B 站 JSON」这一步目前只有单元测试覆盖（fixture 严格按真实响应结构 `{ body: [{ from, to, content }] }` 编写），**尚未在浏览器里下载过真实字幕文件**。这是发布前最需要人工复核的一项，请登录 B 站后点一次「获取字幕」确认。
5. **页面脚本未连接时信息降级。** 标题退化为标签页标题（已清理 `_哔哩哔哩_bilibili` 后缀），作者与时长显示为空，界面以黄色状态点提示。
6. **DOM 选择器为多级兜底。** 标题/作者/时长分别有若干候选选择器与 `og:title`、`video.duration` 兜底；B 站改版后可能读不到作者或时长，此时返回 `null`。无头环境不播放视频，`video.duration` 常为 `null`，表现为「时长」标签不显示。
7. **Popup 不会随分 P 自动刷新。** Popup 打开后不监听 URL 变化，切换分 P 需关闭弹窗重新点击图标（「重新检测」可手动刷新）。页面内入口则会轮询 `location.href`，切视频/切 P 时会重建横幅与面板地址。
8. **`normalizeBaseUrl` 会裁剪路径末尾斜杠。** 若服务端要求保留（例如以斜杠区分端点），需要后续增加「自定义 Chat Completions 路径」选项。
9. **章节时间戳完全取自素材里出现的真实时间点。** 模型若编造时间，解析会记录为 0（界面表现为跳到开头），不会强行纠正成看似合理的时间。字幕与画面识别两条路径都已在真实模型上跑通，但模型自身仍可能给出与素材不符的概括，结论只应作为「快速了解」使用。
10. **归并只做一层。** 分段摘要总量超过 12000 tokens 时按段均分预算截断，而不是做二级递归归并。超长视频（例如 3 小时以上）可能因此损失细节，后续可加多级归并。
11. **总结任务不跨浏览器重启续跑。** 分块摘要与任务快照都写在 `chrome.storage.local`，但任务执行中的取消标记、并发池只在内存里；浏览器重启后需重新点「开始总结」，已完成的块会被复用。
12. **Popup 包体较大。** Element Plus 采用全量引入（约 1 MB JS / 350 kB CSS，gzip 后约 335 kB / 50 kB），在地图/弹窗场景可接受；若后续需要压缩体积，可改为按需引入。
13. **本地存储不是密钥库。** API Key 以明文保存在 `chrome.storage.local`，能访问本机浏览器配置的人可读取。界面与 README 均已声明，不将其表述为加密存储。字幕与总结缓存同样是明文。
14. **未做 i18n。** 全部文案为简体中文，硬编码在组件与 `ERROR_MESSAGES` 中（错误码与文案已集中管理，便于后续接入多语言）。
15. **ESLint 版本。** 当前锁定 `eslint@9.39.5`（npm 提示该大版本已进入维护期）。升级到 ESLint 10 需要同步验证 `eslint-plugin-vue` 与 `typescript-eslint` 的兼容性，安排在后续版本处理。
16. **画面识别听不到声音。** 它依据的是静帧，纯口播、纯音乐、以声音为主的内容（例如这轮验证用的 MV）画面信息量有限，总结会明显偏向「画面里出现了什么」。这类视频目前没有更好的免费方案，需要音频转写（见下条）。
17. **音频转写（ASR）尚未实现。** 选型时实测当前验证用的网关只提供 3 个模型（`qwen3.5-flash` / `deepseek-v4-flash` / `qwen3.5-27b`），`/audio/transcriptions` 返回「模型不存在」，**没有 ASR 能力**，因此没有实现一条无法验证的链路。要接这一步需要一个支持 OpenAI `audio/transcriptions` 协议的服务，并在设置里单独配 Base URL / Key / 模型（不复用主模型 Key），届时按 1.7 的方式接入，把转写结果作为第三种来源打标签。
18. **抽帧必须在目标标签页处于前台时进行。** 后台标签页会被浏览器节流，视频解码与 `seek` 可能停滞。抽帧期间视频会被暂停并在若干时间点跳转，结束后自动恢复原位置与播放状态；这是让 canvas 拿到正确帧的必要代价，不是模拟进度。
19. **画面识别的成本与视频长度弱相关，但与保留帧上限成正比。** 每 6 帧一次模型调用，默认 200 帧上限意味着最多约 34 次视觉调用。长视频建议调低「保留帧上限」，或在已有完整讲稿时直接复用（面板会显示「已有 N 条画面描述」）。
20. **缓存没有容量上限策略。** 目前只限制单条字幕 4 MB，未做总量淘汰；总结与分块缓存同样没有上限（总结成功后会自动清理对应分块缓存），历史记录版本会一并补充 LRU 与手动清理入口。
21. **幕布没有公开写入 API，「复制到幕布」停在「粘贴」这一步。** 幕布未开放文档写入接口（第三方逆向接口不可靠，也不应授权），因此扩展能做到的是「复制大纲 + 打开幕布工作台」，最后一步由你 `Ctrl+V` 完成。**另外：粘贴时按 Tab 缩进识别层级的行文没有在真实幕布账号下验证过**（验证环境无账号）。若你的客户端粘贴后没有层级，可以点「下载 .md」，再在幕布主菜单「+」导入 Markdown——这个格式是幕布官方支持的。
22. **导出依赖页面脚本与目标标签页。** 下载由页面顶层文档发起，如果当前标签页被导航走、或 Content Script 未注入，会提示「导出文件失败，请刷新 B 站页面后重试」；浏览器若对站点限制了自动下载，也需要用户自行放行。
23. **剪贴板存在两级降级。** 面板是跨源 iframe，`navigator.clipboard.writeText` 可能因焦点或 Permissions Policy 被拒（实测无头环境抛 `NotAllowedError`），此时退回 `textarea + execCommand`；两条路径都失败才提示「无法写入剪贴板」。界面只在**确实写入成功**后才显示「已复制」，不会先报成功再失败。
24. **思维导图是固定三层横向树，不会自动折叠。** 结构永远是「视频标题 → 知识点 / 章节 → 章节要点」，不做多级展开、不做折叠交互、不支持拖拽重新排布。标签最多 3 行、每行 17 个「字宽单位」，超出部分会在第 3 行末尾补省略号——**导图是索引，不是全文**，读完整句子请回到面板的「关键要点」与「章节」列表，或导出 Markdown。节点数随要点数和章节数线性增长，一条 60 分钟的课程视频会长成一张很高的图（面板里可滚动，导出后也是原尺寸）。
25. **章节覆盖度保护只补问一次。** 单块直出 + 覆盖度补问能修掉「只总结前段」的常见情况，但它依赖模型配合：若补问结果仍然只覆盖前段，程序不会无限重试（避免把成本放大），此时面板会如实标出「章节只覆盖到 X，素材一直到 Y」。这条提示是判断结果完整性的可靠依据。
26. **字幕 txt 不带样式与分段。** 导出的是「一行一条 + `[mm:ss]`」的纯文本，不改写、不合并句子，方便搜索与二次加工；若需要带说话人、双语对照，需要字幕源自带这些信息。
27. **界面强调色与扩展图标不是同一个颜色，这是有意为之。** 页面内入口按钮、面板、Popup、设置页统一使用 B 站粉 `#fb7299`（唯一来源是 `src/styles/base.css` 的 `--app-accent`，`BrandMark.vue` 通过 `currentColor` 取该变量，不写死色值）；扩展图标（`public/icons/*.png`，由 `design/icons/icon-a-coral*.svg` 经 `scripts/sync-icons.mjs` 生成）仍是设计稿的朱红 `#E4472B`，用于在工具栏上与 B 站官方功能区分。改图标请改设计稿 SVG 后重跑同步脚本，不要反过来去改界面变量。
28. **总结结果自带素材指纹，便于判断「这份总结是不是这个视频的」。** 概述、要点、章节都是模型输出的自由文本，本身不带任何身份信息；一旦上游给错素材，结果看起来依然完全正常。因此 `SummaryResult.material` 会记录 `videoKey`、生成时的标题、字幕条数、素材起止时间与首条原文，面板在脚注下方展示「素材 B 站字幕「…」 · 依据 N 条字幕 · 起–止 · 首条「…」」。**如果你怀疑内容对不上，先把这一行和视频里的实际台词比一比**：这一行对得上而概述跑偏，是模型概括的问题；这一行本身就与本视频无关，是字幕素材的问题（见下条）。旧快照没有该字段，界面按「未知」处理，不显示这一行。面板还会拿这几项自动核对，对不上时把告警摆在概述之前（见第 40 条）。
29. **快照与当前视频不一致时拒绝渲染。** 面板在渲染结果前会比对本页 `videoKey` 与快照的 `videoKey`，不一致则隐藏结果并提示具体是哪两个键，而不是把别人的结论照单显示。正常路径下这个分支不会被触发（键按视频隔离，已单独验证），它守的是数据错配、历史遗留缓存这类异常情况——**宁可显示一条明确的错误，也不要显示一份看起来正常的错总结**。
30. **分 P 找不到时不再回落到第 1 个分 P。** 旧实现里 `pages.find(...) ?? pages[i-1] ?? pages[0]` 会在链接受损时静默改用第 1 个分P的 cid 取字幕——对「一分P一集」的短剧合集来说，这等于拿第一集的字幕去总结第五集。现在直接报「这个视频没有第 N 个分P（当前共 M 个）」，只有 `pages` 整体缺失的单P视频才用接口顶层 `cid` 兜底。
31. **「测试图片能力」成功 ≠ 模型真的会看图。** 有些模型（尤其是中转站上的别名）会**静默丢弃** `image_url` 部分，返回 HTTP 200 但 `content` 是空字符串。实测本机配置的网关（`ai.ctaigw.cn`）上：`deepseek-v4-flash` 带图请求返回 200 + 空内容（1484 ms），`qwen3.5-flash` 对同一张纯红图片正确回答「红色」（1687 ms）。因此测试结果分三档：`imageAccepted: true`「图片输入可用」/ `false`「接口可用，但模型不看图」（黄色警告）/ `undefined`「接口可用（图片能力未验证）」。**视觉模型名请填真正支持图片输入的模型**。真填了不看图的模型也不会白跑：第一批 6 帧返回空内容时就会判失败，明确告诉你「它多半不支持图片输入」（见 1.7）。
32. **`el-input-number` 程序化改值不会刷新显示，需要重建组件。** 用户手输的数字会留在它内部的 `userInput` 里直到失焦，此时外部把 `modelValue` 改成别的值，输入框仍显示旧数字——实测「恢复推荐值」后读数已回到「约 2 分钟」，输入框却还停在 `60`，而实际保存的是 `120000`。「看到的数字和实际存的不一致」比不改还糟，因此两个数字框都用 `:key="\`*-${resetToken}\`"` 绑定到一个自增计数，重置时强制重建。**后续给这类控件加「一键恢复」时，别只改 `modelValue`。** 分块（5 个）与抽帧（4 个）的每个数字框都按这个方式绑了各自的 key，缺一个就会出现「读数变了、输入框没变」。
33. **`vue-tsc` 不校验 SFC 结构是否完整。** 本轮改 `ChunkSection` / `FrameSection` 时漏写了 `<script setup>` 开始标签，`npm run typecheck` 与 `eslint` 都**没有报错**，只有 `vite build` 报 `Element is missing end tag`。因此质量门禁里 `build` 不能省，`typecheck` 通过不代表能构建。
34. **字数与分钟数都是估算，不是精确换算。** 「1 个汉字约 1 token」是 `summary-chunk` 的估算口径（真实分词器对中文通常略低于 1），「250 字/分钟」是普通口播语速。两者只用来让用户判断「一段大概多长」，与实际切分结果、实际耗时都不构成承诺；真实段数以句子和时间边界为准。
35. **面板里的导图默认是缩略视图，读字要放大或导出。** 面板只有 400 多像素宽，一张 600～900 像素宽的导图缩到适配宽度后，12.5px 的字只剩 7px 左右——能看清结构，读不出文字。所以提供了「放大到原始大小 / 缩小到适配宽度」的切换（控件旁标着导图的真实像素尺寸），放大后可横向滚动。**要读字或发给别人，请直接导出 SVG**：矢量格式在任何缩放下都不模糊，PNG 则是 2 倍分辨率的位图。
36. **SVG 导出后用系统看图软件打开可能显示为纯文本。** 部分看图工具按扩展名判断类型，`.svg` 只认「图片」时正常；若工具把它当 XML 显示，用浏览器或矢量软件（Illustrator / Figma / Inkscape）打开即可。导出的 SVG 不引用任何外部字体或图片，样式全部内联，断网、换机器都能正常渲染。
37. **PNG 由浏览器 canvas 栅格化，不保证与浏览器无关的像素级一致。** 同一份 SVG 在不同浏览器、不同 DPI 下画出的 PNG 会有细微抗锯齿差异（字节数不同），这不是错误。导出时的尺寸固定为「布局宽高 × 2」，不随系统缩放变化。
38. **「模型不看图」的判定规则是启发式的。** 规则只有两条：第一批（≥6 帧）返回空串，或连续两批一条描述都解析不出。它不能覆盖所有情况——例如模型每批都只描述其中一帧、其余跳过，程序会认为「有产出」并继续跑完；反过来，一个正常模型偶发两次格式错乱也会被判失败（此时已识别的描述会保留，换模型后「用已识别画面生成总结」还能用）。判定失败时**不会**自动重试或改用别的模型：自动切换模型意味着在用户不知情的情况下把画面发到另一个服务上。
39. **画面识别的进度只有「阶段 + 计数」，没有准确的剩余时间。** 抽帧耗时取决于每次 seek 的实际速度（本地实测 80 ~ 300 ms 不等），识别耗时取决于模型的响应速度，两者都不在本地可控范围内，所以界面只报「已完成 X/Y 段、保留 N 帧」「已看 N 帧、得到 M 条描述」，不给会落空的预计时间。
40. **素材核对只能证明「素材是不是这个视频的」，不能证明「总结写得对不对」。** 它比对三件事：结果记录的视频键、结果声称依据的首句原文是否真在当前字幕里、字幕总长与视频时长是否冲突。因此它能抓住**导入错文件**、**换片后残留旧字幕**、**缓存键配错**这三类素材错配，但抓不住下面两种情况：① 字幕本身是对的，模型自己跑题（此时首句能对上、时长也匹配，任何对照组都无从判断，只能换模型复测）；② 字幕是对的、模型也老实，但视频是「弹幕/画面为主、口播极少」的类型，总结自然寡淡。反过来说，**看到核对区块是空的，只说明素材没错，不代表内容一定准确**——这也是为什么界面保留了「首条原文」这一行，让人可以自己去比。另外首句比对用的是「包含」而非「相等」（`firstText` 截断到 40 字），若两次字幕的**第一句本身就被平台改写过**，会命中 `text-not-found`，此时核对结论偏严，换回平台字幕重新生成即可恢复。
41. **字幕轨道是「先按覆盖率挑、再由用户改」，不是「永远选最长的那条」。** 自动挑选只做三件事：优先中文自动生成轨道、覆盖率明显不足时再试下一条（最多 3 条）、选覆盖最全的那条。它**不判断内容质量**——如果三条轨道都是占位字幕，它会如实挑一条并在卡片上说明「只有 N 条」，剩下的判断交给用户（换轨道、导入自己的字幕、或改用画面识别）。另外「覆盖不到 30%」是按字幕总长与视频时长算的，纯音乐/MV 类视频对白稀疏也会命中提示，此时提示是事实陈述，不代表素材有问题。字幕条数少于 3 条时一定会提示，这类字幕无法支撑总结。

---

## 8. 已实现能力与后续版本路线

| 版本 / 批次 | 内容 | 状态 / 已预留的接口 |
| --- | --- | --- |
| v0.1 批次 1 ✅ | 工程、Popup、设置页、消息通道、设置持久化 | 已完成 |
| v0.1 批次 2 ✅ | 字幕轨道发现、下载、SRT/VTT/JSON 解析导入 | 已完成：`SubtitleProvider`、`subtitle.*` 消息、`api.bilibili.com` 主机权限、`SubtitleRepository` 缓存 |
| v0.1 批次 3 ✅ | OpenAI 兼容调用、连通性测试、错误映射 | 已完成：`AIProvider` + `OpenAiCompatibleProvider`（`core/ai/`）、401/403/429/404/5xx 映射、`ai.testConnection`、域名按需授权 |
| v1.0 ✅ | 页面内入口、ChunkPlanner、分块总结、分层归并、任务持久化与恢复 | 已完成：`content/banner.ts`（Shadow DOM 行内按钮 + 就地展开面板）、`panel/`（面板 UI）、`core/summary/`（分块 / 提示词 / 解析 / 并发编排）、`summary-service.ts`（快照 + 分块缓存 + SW 回收兜底） |
| v1.0 ✅ | 无字幕画面识别：抽帧采样、视觉模型逐帧描述、来源标签、讲稿断点复用 | 已完成：`core/frames/`（采样器 / 提示词 / 解析 / 类型与参数）、`content/frame-capture.ts`（canvas 抽帧，零新增权限）、`background/frame-service.ts`（探索轮 → 编码轮 → 视觉识别 → 复用总结管线）、`core/ai/vision-provider.ts`、`options/VisionSection.vue` 与 `options/FrameSection.vue`；`SummarySource` 区分 `subtitle` / `frames` |
| v1.0 ✅ | 导出 Markdown 文件与幕布大纲 | 已完成：`core/export/`（Markdown 序列化 / 幕布大纲 / 文件名规范化，纯函数）、`export.download` → `content.download`（由页面顶层文档下载）、`export.openMubu`（`chrome.tabs.create`）；**零新增权限**，未使用 `downloads` |
| v1.0 ✅ | 知识点与思维导图，导出 SVG / PNG | 已完成：`core/mindmap/`（建树 / 布局 / SVG 渲染，纯函数，14 个单元测试）、`core/export/mindmap.ts`（组装与文件名）、`panel/svg-to-png.ts`（canvas 栅格化）、面板内导图预览与两种倍率切换；SVG 走 UTF-8、PNG 走 base64，复用 `export.download` 通道，**零新增权限** |
| v1.1（计划） | 信息图（另一种排版，与思维导图并列） | 待接入。复用 `core/mindmap/layout.ts` 的度量与折行逻辑，只换排布与配色 |
| v1.2（计划） | 历史记录、去重缓存、异常场景与性能检查 | 待接入。视频身份已提供稳定去重键（`BV...p2` / `av...p#` / `ep...`）；字幕与总结均按同一 key 落盘，可直接复用为历史索引 |

架构上的保证：新增能力只需扩展消息契约与 `core/` 中的 Provider，不需要改动 Popup 的通信方式；未来接入 Spring Boot 后端时，可在 `AIProvider` / `SubtitleProvider` 实现层切换到远端服务，UI 与流程编排不受影响。

---

## 9. 测试

```bash
npm test
```

覆盖范围（均为纯逻辑，不依赖浏览器 API）：

- `tests/parse-video-url.test.ts`：BV / av / 番剧 / 分 P / 非法链接 / Content Script 注入判定
- `tests/settings-normalize.test.ts`：Base URL 规范化、数值夹紧、跨字段收敛、未知字段过滤
- `tests/settings-repository.test.ts`：默认值、分区合并、持久化、issues、reset、返回值与存储解耦
- `tests/message-router.test.ts`：成功信封、未知类型、非法 payload、AppError 保真、普通异常收敛、5 个字幕 handler
- `tests/format-and-context.test.ts`：时间格式化、密钥脱敏、时长文本解析、标签页标题清理
- `tests/subtitle-parsers.test.ts`：SRT / WebVTT / B 站 JSON / 通用 cues 解析、容错与格式判定
- `tests/subtitle-normalize.test.ts`：文本清理（HTML / ASS / 实体）、排序重编号、时间修正、空字幕报错
- `tests/subtitle-repository.test.ts`：读写、结构校验、损坏清除、4 MB 上限、UTF-8 → GBK 编码回退
- `tests/subtitle-provider.test.ts`：cid 选择（含分 P）、轨道映射（AI / 锁定）、四种可用性状态、页面通道补位
- `tests/summary-chunk.test.ts`：token 估算、`[mm:ss]` 渲染、分块边界、重叠回退、块数上限、块索引连续
- `tests/summary-parse.test.ts`：时间解析、JSON 围栏提取、章节排序与结束时间补齐、非法输出报错
- `tests/summary-resume.test.ts`：分块指纹失效判定、全量/部分缓存复用、时间范围错位不复用、逐块回调、失败即终止
- `tests/frame-sampler.test.ts`：槽位规划、长视频放宽间隔、帧差阈值、候选预算上限、取消响应
- `tests/frame-parse.test.ts`：「序号 | 描述」解析与时间戳回填、多种行首格式、越界与重复行计数、cue 边界延伸
- `tests/frame-service.test.ts`：断点去重、批次消费、失败保全、零条目与取消分支、复用完整讲稿
- `tests/export.test.ts`：Markdown 结构（元信息 / 来源单位 / 时间戳链接 / 空段落省略）、幕布大纲层级与 Tab 缩进、字幕 txt 头部与逐行格式、文件名规范化（非法字符 / 保留名 / 码点截断）、句子拆分与合并上限
- `tests/summary-coverage.test.ts`：章节覆盖率判定、补全指令文案、单块直出（不发分块摘要、消息里是原始时间戳字幕）、覆盖不足补问一次、补问失败保留原结果、短视频不补问
- `tests/vision-test-result.test.ts`：测试图片能力的三档判定（真的看图 / 接口通但返回空内容 / 环境无法验证）与对应文案，防止把「HTTP 200」当成「模型会看图」
- `tests/summary-material-consistency.test.ts`（19 用例）：素材核对的三重比对——视频键不一致、首句原文找不到（含标点差异不计、截断在句中仍能匹配）、条数漂移（含 15% 容忍带）、时长溢出、覆盖不足（含 5 分钟门槛与 PV 类视频不误报）、本地导入来源标注、画面识别跳过字幕比对、旧快照与未加载字幕时不做比对、已判定首句不符时不叠加时长告警

---

## 10. 打包与上架

### 10.1 一条命令出正式版

```bash
npm run release
```

`scripts/build-release.mjs` 依次做三件事，任何一步不通过都不会产出安装包：

1. **校验版本一致**：`package.json` 与 `src/core/config/app.ts` 的 `APP_VERSION` 必须相同，且是 `x.y.z`。这两处各存一份（manifest 用前者不可达，构建产物用后者），漏改一处就会出现「商店版本与页面显示不一致」。
2. **完整构建**：跑 `npm run build`（含 `vue-tsc`），确保 zip 里不是旧产物。
3. **打包**：把 `dist/` 的内容放到 zip **根目录**（`manifest.json` 在顶层，这是商店要求的结构），输出 `release/bilibili-ai-summary-<version>.zip`，同时打印文件数、原始/压缩体积与 sha256。

打包前后的体检项：manifest 版本与 `package.json` 一致、四个尺寸图标都存在、`content_scripts` / `background` / `options_ui` / `web_accessible_resources` 引用的文件全部真实存在。这些引用带 hash，构建产物改名后最容易失效。

`--skip-build` 可跳过构建直接用现有 `dist/`，只在你刚构建过、只想重打包时用。

ZIP 由脚本内置的最简实现写出（deflate + CRC32，约 80 行），**没有引入任何新依赖**。已验证：用系统解压工具还原出的 28 个文件与 `dist/` 逐个文件名、逐个字节数一致。

### 10.2 两种安装方式

- **开发自测**：扩展管理页开启开发者模式 →「加载已解压的扩展程序」→ 选 `dist/`（或解压后的目录）
- **正式分发**：把 zip 上传到 Chrome 应用商店；离线分发则解压后同上加载
- **Edge**：同一份 `dist/` 在 `edge://extensions` 里「加载解压缩的扩展」即可，无需改造；上架则把同一个 zip 传到 Edge 加载项商店（独立后台，需另填一份表单）。详见 §1.10
- **GitHub Releases**：`v1.0.2` 已挂上两个 zip（分享包 + 商店包），[下载页](https://github.com/522963969/bilibili-ai-summary/releases/latest) 就是「给别人的那个文件」。以后每次发版把新的 share zip 作为 asset 传上去，`/releases/latest` 会自动指向最新版。
- **给个人分发（不上架）**：`npm run share` 生成 `release/bilibili-ai-summary-<版本>-share.zip`，里面是扩展 + `START-HERE.html` 安装说明。**发给非技术用户请用这个，不要发商店包**——商店包只有代码，对方拿到不知道该干什么，也常常把 zip 直接拖进浏览器（装不上）。

两个 zip 的区别只有一点，别传错：

| 文件 | 内容 | 给谁 |
| --- | --- | --- |
| `bilibili-ai-summary-1.0.2.zip` | 28 个文件，扩展本体在 zip 根 | 提交 Chrome / Edge 应用商店 |
| `bilibili-ai-summary-1.0.2-share.zip` | 同上 28 个文件 + `START-HERE.html`，仍在同一层 | 直接发给个人，解压后加载那一层

### 10.3 上架清单

全部填表材料在 **`store/listing.md`**：简短说明、详细说明、逐条权限理由、隐私规范表单答案、图片素材、提交步骤，以及「容易被退回的点」。隐私政策在 **`PRIVACY.md`**，上架前必须托管到一个可公开访问的 URL（后台不接受本地文件），并把文末的邮箱与仓库地址替换成真实值。

商店截图放在 `store/screenshots/`（1280×800 与 440×280，均已按规格生成）。**视频页面板那张需要你自己补**——生成一张有真实摘要的截图必须要你的 B 站登录态和有效 API Key，原因与拍摄方法见 `store/listing.md` 第 5 节。

### 10.4 发下一个版本

改版本号 → `npm run release` → `npm run share` → 上传（商店传前者，Releases 传后者）。三点注意：

- 商店要求版本号**严格递增**，脚本只校验两处一致，不替你判断是否大于线上版本
- 用户更新后 `chrome.storage.local` 里的旧设置会保留，`normalizeSettings` 自动补齐新增字段（见 §4），不需要让用户重填
- Releases 上的 asset 名带版本号（`bilibili-ai-summary-<版本>-share.zip`），同一个 tag 下别覆盖旧文件，否则已下载的人无法判断自己拿的是哪版

---

## 11. 许可与声明

代码以 **MIT 许可证**发布，见 [LICENSE](LICENSE)。你可以自由使用、修改、再分发，只需保留版权声明与许可证原文。

非官方扩展，与哔哩哔哩无隶属关系，「B站 / 哔哩哔哩」仅用于说明适用网站。使用前请自行确认模型服务条款与 B 站用户协议；扩展不会绕过登录、权限或平台访问控制，读取不到的数据一律如实提示。
