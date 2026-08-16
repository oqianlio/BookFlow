# 开发经验库（Lessons Learned）

> **机制**：每次开发后把经验追加到本文件（按主题分类，标注日期）；每次开发前
> 先阅读相关主题，尤其检查"已知坑"。经验 = 场景 + 认知 + 下次怎么做。

## 一、规则引擎 / legado 兼容

### 1.1 学习原版必须核对源码，不要凭记忆（2026-08-15）
- 场景：实现 `##` 替换、`!N` 索引、检测关键字时，凭记忆猜测 legado 语义。
- 认知：`##re##rep###` 的 replaceFirst（无匹配返回空）、`!N` 在列表规则 =
  **跳过前 N 个取剩余**（跳表头）、默认检测关键字"我的"（实测 64 vs 56 可用源）、
  书源 `ruleSearch.checkKeyWord` 覆盖——全部从原版源码确认才做对。
- 下次：实现 legado 语法前，先抓 `huajideshutiao/legado` fork 对应源码
  （`AnalyzeRule.kt`/`CheckSourceService.kt`/`BookSource.kt`），文档级确认语义。

### 1.2 判定标准按自身能力校准，机制照搬原版（2026-08-15）
- 场景：批量验证照搬原版严格模式（目录/正文失败即判源失效）。
- 认知：真实源实测把可用源 **72 → 9**——降级几乎全是详情页网络/反爬
  （fetch failed/403），轻量检测无 Referer/cookie 全流程。改为 ok 由搜索判定，
  目录/正文失败仅作质量标记（黄徽标）。
- 下次：照搬原版机制前先想"我的实现是否有原版的隐含前提"（完整请求上下文）。

### 1.3 真实源测试驱动验证有效（2026-08-15）
- 场景：每个规则缺口都从健康检查失败源出发（随心看 bookUrl 空、快眼看书 tag.li）。
- 认知：修复后必须**真机验证**（单源调试），单元测试无法代替真实网络。
  可用源 16 → 64/274。
- 下次：规则改动默认配一次真实源验证（SOURCE_HEALTH 门控脚本）。

### 1.4 测试用例先验证假设（2026-08-15）
- 场景：`class.recommend[-1]` 测试期望取"最后一个子元素"，实际语义是
  "最后一个匹配元素"；`<h3>` 是标签不是 `.h3` 类。
- 认知：失败 4 个测试里 3 个是**测试期望错误**而非实现错误。先单独验证
  parseRule/queryIndexed 行为再写断言。
- 下次：链式/索引类测试，先用最小 HTML 单独探针验证解析结果。

### 1.5 querySelector 合法无匹配会提前返回（2026-08-15）
- 场景：`tag.span` 作为 CSS 选择器合法（tag 元素带 class）但无匹配 → 返回
  null 提前退出，`tag.X` 回退分支永远不执行。
- 下次：queryIndexed 的回退链里，合法但 null 的结果要继续走后续回退分支。

## 二、工程实践 / 工具链

### 2.1 文件修改用 write/edit 工具，避免 PowerShell 拼接（2026-08-15）
- 场景：用 PowerShell `Get-Content`+字符串替换/`Add-Content` 改测试文件，
  三次弄坏文件（转义、拼接错位），被迫 git checkout 重做。
- 下次：测试/源码改动一律用 write/edit 工具；PowerShell 只用于读/执行。

### 2.2 commit message 文件勿被 `git add -A` 扫入（2026-08-15）
- 场景：`git add -A` 把 commit_msg*.txt 一并提交，需追加"删除杂散文件"提交。
- 下次：精确 `git add <文件列表>`；或 msg 文件放临时目录。

### 2.3 偶发测试失败先判断是否本次引入（2026-08-15）
- 场景：全量跑出现 1 failed（MdReader line offset），单独跑 5 次全过。
- 认知：既有异步时序问题，与本次改动无关；不要为此打断提交节奏，
  但要记录并确认。
- 下次：全量失败先单独重跑定位，判断归属再处理。

### 2.4 测试工具保真度决定结论可信度（2026-08-15）
- 场景：健康检查 mock httpGet 丢弃 method/body → POST 源全误报"无结果"；
  TextDecoder utf-8 不抛错（U+FFFD 替换）→ GBK 回退永不触发。
- 认知：修正后可用源 41→52（POST 转发）、GBK 站点正常解码。
- 下次：写网络 mock 时核对真实调用签名；编码回退用 `{ fatal: true }`。

### 2.5 vi.mock 工厂必须与组件 import 对齐（2026-08-15）
- 场景：组件新增 import `respondTimeOf` 后，测试 mock 工厂缺该导出 →
  undefined 调用崩溃，15 个测试全挂。
- 下次：组件 import 变化时同步检查测试 mock 工厂。

### 2.6 单元测试的 jsdom 环境坑（2026-08-15 前）
- jsdom 只读属性（children/body/text）需 `Object.defineProperty` 覆盖；
  localStorage 需在 beforeEach 清理；`vi.spyOn` 复用需 mockImplementation。

### 2.7 真实源素材管理（2026-08-15）
- legado 官方 GitHub main 分支只有 README，源码在 fork
  （`huajideshutiao/legado`）；临时抓取的源码文件用完即删（已 gitignore 类处理）。

## 三、产品 / 用户价值

### 3.1 机制设计：数据即状态（2026-08-15）
- 场景：批量验证结果原设计为内存 Map（当次会话）。
- 认知：原版把检测状态写成书源分组标记（bookSourceGroup），持久化后天然
  支持筛选/显示/删除/跨会话，还复用分组 UI——一个机制解决四件事。
- 下次：先问"这个状态能不能作为数据的一部分持久化"，而不是临时内存态。

### 3.2 用户反馈驱动的方向修正（2026-08-15）
- "参考原版"不是抄代码，是先理解原版为什么这么做（机制/心智模型），
  再迁移并校准到自身能力边界。

### 3.3 全链路验证优于单环节验证（2026-08-15）
- 场景：健康检查只测"搜索"，S1 全链路（搜索→目录→正文）实测
  搜索可用 68/274，但目录环节仅 12/34、正文 8/10——"能搜到"与
  "能读完"差距巨大（68 vs ~12）。
- 下次：验证脚本按环节分类（network/empty/norule），逐源实时打印 +
  allSettled（个别源卡死也有数据、可定位元凶）。

### 3.4 同步 JS 无法超时中断（2026-08-15）
- 场景：搬山人小说网 jsBlock 同步卡死（疑似灾难性正则），卡住整个
  检测 chunk；Promise.race/AbortController 均无法中断同步代码。
- 下次：检测脚本逐源/逐 chunk 打印进度定位元凶；引擎级防护只能
  靠输入截断或隔离（worker/子进程），记录为已知限制。

### 3.5 失败分类先于归因（2026-08-15）
- 场景：目录 empty 类 13 源，逐个分析发现多为 TXT 下载站/站内无阅读
  页/源规则过时（365小说网 `dl > dd` 不匹配），非引擎缺口。
- 下次：先按 network/empty 分类再归因，避免把站点问题当引擎问题修。

### 3.6 端到端验证比环节验证更能暴露集成缺口（2026-08-15）
- 场景：36小说网目录/正文单环节看似正常，但端到端（fetchToc 分页 +
  正文 js 提取）暴露 jsBlock 无 after 时结果被丢弃、java.getString 缺失、
  text.xxx 锚点不支持、裸单词属性名——4 个独立缺口串成一条链路。
- 下次：对代表性源做"搜索→目录→正文"端到端验证（fetchToc + 第一章
  正文），能一次暴露多个环节的集成缺口。

### 3.7 页面结构先抓取再模拟（2026-08-15）
- 场景：36小说网正文 js 看似失败，node 模拟（抓真实页面 + 跑书源 js）
  一次成功——引擎路径问题而非页面问题。
- 下次：js 规则失败时，先 node 模拟书源 js 对真实页面跑通，再查引擎
  差异点（result 传递、jsBlock 返回、规则解析）。

### 3.8 基础功能缺口藏在 specs 的"不做/后续"里（2026-08-15）
- 场景：转向基础功能时，盘点 specs 发现本地书阅读设置被标记 3 次
  "后续/不做"（r3/r8/r19）——是最久的基础缺口，非边角。
- 下次：做基础功能前先系统盘点 specs 的"不做/后续"项，按用户价值排序。

### 3.9 先验证渲染链再改 UI（2026-08-15）
- 场景：本地书阅读设置看似要改 4 个阅读器，实查发现 .reader-main 已
  对全部阅读器设置 CSS 变量、.md-content 已消费——MD/TXT 唯一缺口是
  设置面板的 `!isLocal` 开关。
- 下次：改动前先追数据流（props/变量/选择器），避免改多余组件。

### 3.10 第三方 API 类型签名要实测（2026-08-15）
- 场景：epubjs `themes.override(name, value, selector?)` 的类型签名误导，
  实际第三参是 boolean（priority）；改用 `themes.default({body:{...}})`。
- 下次：库 API 按类型写代码遇到编译错误时，查文档/实测签名而非硬凑。

### 3.11 字典类测试用字典内字（2026-08-15）
- 场景：简繁测试用"龍"失败——字典是单字映射子集（无龍），且"説"
  （异体）≠"說"（正体）不同码点。
- 下次：映射类测试先用字典确认存在，注意异体字码点差异。

### 3.12 规则引擎多缺口靠"多源并行验证"一次性暴露（2026-08-16）
- 场景：S2-J 修复 6 个 JSON API 源，一次 debug 脚本同时测 6 源，暴露
  7 个独立引擎缺口：`{{page}}` 未替换、`$..` 递归缺失、JSON `##` 2 段删除、
  `&&` 拆分误切 `@js:` 块、无 `$` 前缀 JSON 路径判为 CSS、`{{...}}` 模板缺失、
  @js 返回 JSON 字符串项未解析。
- 认知：单源验证只能暴露该源命中的缺口；多源同跑让缺口互相印证，
  且"响应有数据但提取为空"这类共性问题一眼可见。
- 下次：批量源修复时先做一个覆盖全部目标的 debug 脚本（打印每源
  原始响应长度 + 提取结果），再逐个修复。

### 3.13 限频与规则缺口要区分（2026-08-16）
- 场景：丁丁小说 page=1 报"请勿频繁操作"（4011），初判为限频误报；
  间隔 3-18s 多次探测仍 4011，而 page=2 恒 200——是 API 对 page=1
  的**定向反爬**，非临时限频。
- 认知：真实验证时"失败"要先区分：临时限频（间隔重试）vs 定向屏蔽
  （换参数对照）vs 规则缺口（换路径对照）。改 header/UA 无效时基本
  是定向屏蔽。
- 下次：源失败先做"参数对照探测"（page=1 vs page=2、有无 header），
  再决定修规则（如 @js 偏移 page+1）还是删源。

### 3.14 无 `$` 前缀 JSON 路径与 CSS 下标选择器歧义（2026-08-16）
- 场景：`data.state[*]` 需判为 JSON，但 `class.recommend[0]`/`tag.li[-1]`
  是 CSS 类/标签下标（`[0]`/`[-1]` 两者通用）——按语法无法完全区分。
- 认知：`[*]`、`[a:b]`、`[?(...)]` 是 JSON 独有写法（CSS 不会用），
  用它触发 JSON 判定；数字下标留给 CSS 选择器，语义安全。
- 下次：语法歧义时选"无歧义子集"触发，宁可漏判也不误伤。

### 3.15 源规则可以在 DB 直接修正（2026-08-16）
- 场景：南极 bookList `data.state[*]` 层级不对（书名在 items 层）、
  丁丁 page=1 被屏蔽——均通过 node:sqlite 直接 UPDATE book_sources.json，
  再 cargo run --bin export_sources 重新导出验证。
- 认知：legado 生态里"源规则过时"是常态，修正源与修引擎同等重要；
  DB 直改 + 备份（.bak-before-s2j）+ 重新导出是可重复流程。
- 下次：源规则问题先备份 DB 再改，改完立即重新导出并端到端验证。

### 3.16 测试环境 ≠ 运行环境：Node 专用依赖会白屏（2026-08-16）
- 场景：GBK charset 支持引入 iconv-lite 后，Tauri 窗口白屏；vitest 全绿
  （479 passed）但真实 WebView 空白。Edge headless dump 发现
  `Uncaught TypeError: Cannot read properties of undefined (reading 'prototype')`
  来自 iconv-lite（依赖 Node buffer，vite 外部化 buffer → Buffer 为 undefined）。
- 认知：**vitest 跑在 Node，Node builtin（buffer/stream/process）都有；
  浏览器/WebView 没有**。引入依赖时先查其 Node 依赖链
  （require 追踪：iconv-lite → safer-buffer → buffer/stream）。
  构建时的 `Module "buffer" has been externalized` 警告就是白屏前兆。
- 下次：前端依赖引入后**必须用真实浏览器验证渲染**（Edge headless
  `--dump-dom` + 查 console），不能只靠 vitest；build 警告里的
  externalized 提示要当错误处理。

### 3.17 Windows vite host 绑定与 WebView 解析（2026-08-16）
- 场景：白屏排查中，vite `host: false` 只监听 IPv6 [::1]:1420，
  WebView2 解析 `localhost` 走 IPv4 → 连不上 → 空白；netstat 看不到
  ESTABLISHED 连接是判据。改 vite `host: "127.0.0.1"` + tauri devUrl
  同步改 `http://127.0.0.1:1420` 后连接建立。
- 认知：Windows 上 localhost 解析有 IPv4/IPv6 歧义；tauri dev 的
  devUrl 和 vite server.host 必须明确一致。
- 下次：白屏先分三层排查——连接层（netstat ESTABLISHED）、
  加载层（Edge headless dump-dom 看 root 是否渲染）、运行时层（console 报错）。

### 3.18 开发者日志是调试加速器（2026-08-16）
- 场景：实现开发者日志（前端 console/error 劫持 → log_frontend →
  $APPDATA/logs/app.log + 设置页查看面板）。上线后用户实际操作
  立刻暴露两个既有 bug：书源 evalJs `id is not defined`、React
  duplicate key（半山人小说网）。
- 认知：全局错误/警告收集 + 文件持久化 + UI 查看，让"用户操作时的
  真实错误"可回溯，不用复现即可定位；比只看 tauri 终端强（打包后
  无终端）。
- 下次：日志上报链路要防循环（上报失败静默 catch，否则 rejection
  再触发 unhandledrejection 无限递归）；新功能上线后让用户操作并
  检查日志，常能立刻发现潜伏 bug。

### 3.19 Rust 测试目录隔离（2026-08-16）
- 场景：logs.rs 单元测试用固定 temp 目录，测试间残留导致
  `left: 7, right: 2` 失败。
- 下次：文件系统测试每个用例独立子目录（tag 区分），开头清理。

### 3.20 调试设施要覆盖"我看不到的层"（2026-08-16）
- 场景：实现开发调试设施（Rust 统一日志、网络请求日志、invoke 跟踪、
  ErrorBoundary、诊断导出）。上线后用户搜索"吞噬星空"，日志立刻暴露：
  起点 searchUrl 模板残留 `{{page - 1 == ...`（未替换条件表达式）、
  56zw/3322t 书源 evalJs 错误、banshanren React duplicate key。
- 认知：调试设施的价值 = 覆盖盲区。前端 console 日志只能看到前端；
  Rust 侧 println 打包后丢失；网络请求只有终端可见——把关键事件
  持久化到同一 app.log 后，开发 agent 直接读文件就能定位问题，
  不需要用户复述。
- 下次：新功能上线后让用户真实操作 + 读 app.log 交叉验证，常能
  立刻发现潜伏 bug；watch 编译的中间态报错是编辑时序噪声，以
  cargo check + 最终编译为准。

### 3.21 正则解析 HTML 必翻车，DOM 解析兜底（2026-08-16）
- 场景：分页器用 `/<(p|div|h[1-6]|li|pre)[^>]*>[\s\S]*?<\/\1>/g`
  提取块级元素。用户报"章节只有一页"——书源正文常见结构全部匹配
  失败：未闭合标签（HTML 常态）、`<br>` 分段（"您现在阅读的是…"
  格式）、纯文本无标签、整章单大块 → 直接整篇一页。
- 认知：**正则不是 HTML 解析器**。未闭合标签必须靠 HTML5 解析器
  补全（document 容器 innerHTML 即可，jsdom 同款）；`<br>` 和换行
  是纯文本正文的段边界。修复：正则快速路径匹配 ≤1 块时，DOM 解析
  回退重新分块。
- 下次：任何"从 HTML 提取结构"的逻辑，优先 DOM 解析；正则只作
  快速路径且必须有 DOM 兜底。验证用真实书源正文结构（未闭合/br/
  纯文本）而非理想 HTML。

### 3.22 nextContentUrl 是"本章下一页"不是"下一章"（2026-08-16）
- 场景：用户报"章节不全"。36xs 章节 `<h3>第004章（第1页）</h3>`，
  base64 提取只含第 1 页（1467B），nextContentUrl 提取 `6516910_1.html`
  被误当"下一章"URL → 当前章缺页、点下一章却进本章第 2 页、章节
  index 错乱。
- 认知：**legado 语义 nextContentUrl = 同章节分页**，应循环抓取拼接
  完整章节；下一章由目录（toc[idx+1]）决定。但部分书源把真"下一章"
  写进 nextContentUrl——用**同前缀判定**区分：分页 URL 与当前 URL
  同前缀（6516910.html → 6516910_1.html），下一章前缀不同。
- 下次：多页正文源（h3 标"第N页"、URL 带 _N.html）优先怀疑
  nextContentUrl 未拼接；修复后查日志"分页拼接 N"确认链式抓取。

### 3.23 用户"一页/不全"等模糊反馈先确认真实场景（2026-08-16）
- 场景：用户说"一个章节只有一页，有问题"，初判为分页器问题并修复；
  用户澄清"我的意思是一章节不全"——实际是内容缺失（分页未拼接）。
- 认知：模糊反馈先看 app.log 的真实数据（content len、URL 模式）
  再动手，避免修错层；两次修复（分页器 DOM 回退 + 分页拼接）其实
  都是真实问题，但第二次才是用户所指。
- 下次：对"xx 有问题"先问清现象（一页？不全？加载失败？），或先
  用日志数据自我验证假设再改。

### 3.24 规则提取空字符串是"请求构建失败"的元凶（2026-08-16）
- 场景：用户报"请求构建失败"。app.log 显示 `GET  ERROR 请求构建失败：
  (0ms)`——URL 为空。根因：错层小说 ruleBookInfo.tocUrl =
  `text.查看全部章节@href` 在页面无此链接 → 提取空串 → `httpGet("")`
  → reqwest builder 错误。
- 认知：**任何规则提取都可能返回空**。空 URL 请求是最隐蔽的失败
  模式（reqwest 报"请求构建失败"而非网络错误，难定位）。防御：
  调用方回退（tocUrl 空 → 用书页）+ 传输层拒绝（Rust 空 URL 直接
  返回友好错误 + 前端 httpGet 空 URL 抛错）。
- 下次：看到"请求构建失败"先查是否空 URL（日志 GET 后无地址）；
  新规则接入时注意提取空值的回退路径。

### 3.25 目录数量不对：tocUrl 规则 + text.xxx 选择器双重 bug（2026-08-16）
- 场景：用户让自查"章节数量"。错层小说书页目录只有 3 章（第2974章
  等最近更新）+ "查看全部章节 >>"入口，完整目录 2973 章在
  /book/chapter/ 分页页。验证链条暴露两个 bug：
  1. **tocUrl 规则错**：`text.查看全部章节@href`——页面文本是
     "查看全部章节 >>"（带符号），且真实页面结构与我早期探测的
     不同（无 id=linkIndex）→ 需用 `#allchapter a[href*="/book/chapter/"]@href`
  2. **引擎 text.xxx 实现错**：a) 完全匹配（should be contains，
     legado jsoup :containsOwn 语义）；b) 用 textContent 会让祖先
     元素（html）先命中 → 必须用 ownText（直接文本子节点）
- 认知：**验证目录完整性要数章节数**（前/中/末 + 连续编号），不能
  只看"能打开"；text.xxx 是 legado 高频锚点规则，实现必须对齐
  containsOwn 语义。
- 下次：源规则修完用端到端计数验证（写临时 vitest 脚本跑真实
  页面）；真实页面结构不稳定（A/B、登录态），探测要多抓几次。

### 3.26 "章节不完整"的真凶：extractSingle 缺 `<js>` 后缀处理（2026-08-16）
- 场景：用户反复说"章节不完整"。36xs 章节标题标"（第1页）"且
  word_read 有 `6516912_1.html` 分页链接，但内容只到第 1 页
  （1229B）。根因链：text.xxx 修复后 `text.下一@href` 能提取链接，
  但 nextContentUrl 完整规则 `text.下一@href\n<js>检测</js>` 仍返回
  空——**extractSingle（顶层规则）没有 `<js>` 后缀处理**（只有
  extractFromElement 有），`<js>` 块被当 CSS 残留吞掉。
- 认知：**规则语法支持要检查所有执行入口**——`<js>` 后缀在 item
  规则（extractFromElement）和顶层规则（extractSingle）都出现，
  只修一处则另一处静默失败，表现为"内容不完整"而非报错。
- 下次：修规则语法时全局搜该语法的所有使用入口（extractSingle/
  extractFromElement/extractList），各补测试；"章节不完整"先看
  页面标题是否标"（第N页）"、word_read 有无 _N.html 分页链接。

### 3.27 vitest 4 不继承外部 env（2026-08-16）
- 场景：SOURCE_HEALTH 门控测试突然全 skip——vitest 4 测试进程
  不再透传 shell 环境变量（process.env.SOURCE_HEALTH undefined）。
- 认知：临时验证脚本不要依赖 env 门控，直接改 ENABLED 常量；
  test.env 配置注入也无效（config 加载时机不同）。正式测试不
  依赖外部 env。
- 下次：真实源验证脚本用常量开关，不用 process.env。

### 3.28 测试全绿 ≠ 真实可用：jsdom 无布局掩盖分页 bug（2026-08-16）
- 场景：用户连续反馈"每章只能看一页""测试有什么用"。真实浏览器
  （Edge headless dump-dom）复现：60 段内容只分 1 页！根因：
  sliceByBatchMeasure 用 `host.firstElementChild` 取测量容器，但
  styleHtml 注入后第一个子元素是 `<style>` → parent 无子元素 →
  整篇一页。**jsdom 测试全用 mockMeasure（sliceByAccumulate），
  真实分页路径（sliceByBatchMeasure）从未被测试覆盖**。
- 认知：**布局相关逻辑必须用真实浏览器验证**（Edge headless +
  file:// 页面 + dump-dom 读结果），jsdom 没有布局无法测 offsetTop
  分页。测试环境与运行环境的差异会静默掩盖致命 bug。
- 下次：分页/测量/布局类逻辑，写独立 HTML 页面用 Edge headless
  验证（可复现、可回归）；修复后先真实验证再提交。

### 3.29 API 源"打不开"是规则链缺口，逐环打通（2026-08-16）
- 场景：用户报"搜索出的书不能打开"。南极（松鹤庭沐）bookInfo API
  无 Referer 返回 17B `"incorrect referer"`；ruleBookInfo 的
  `init: $.data.bookInfo` 引擎不支持；tocUrl 模板 `{{$.resourceID}}`
  被当正则；chapterUrl 的 `{{baseUrl.match(/bookId=(\d+)/)[1]}}`
  js 表达式模板不支持——**四个缺口叠加**导致目录为空。
- 认知：API 源（非 HTML 页）的书打开链路是：bookUrl(带 header) →
  init 定位 → 模板拼 tocUrl → toc API → chapterUrl 模板。任一环
  缺口都表现为"打不开"。逐一用真实 API 验证修复（Referer、
  init 规则、JSON 路径模板、js 表达式模板）。
- 下次：API 源打不开先抓各环节真实响应（长度+内容），按链路
  逐环定位；`{{...}}` 模板有三态：JSON 路径/正则/js 表达式。

### 3.30 真实浏览器验证分页必须看渲染结果（2026-08-16）
- 场景：Edge headless `--dump-dom` 不输出 console.log——把验证
  结果写入 DOM（<pre id="result">）再 dump 读取。
- 下次：headless 验证脚本把结果写进页面 DOM 而非 console。

### 3.31 翻页边界语义：到达末页 ≠ 触发下一章（2026-08-16）
- 场景：用户报"10/11 下一页应该到 11/11，却直接跳下一章节"。
  onReachEnd 条件 `c === total-1 && p > page`——翻到最后一页
  （10/11→11/11）就误触发。正确语义：**到达末页是正常翻页，
  从末页再往前翻（越过 p > total-1）才衔接下一章**（与
  onReachStart 的 p < 0 对称）。
- 认知：边界条件要"对称"思考（onReachStart 用 p<0 越界判断，
  onReachEnd 却用"到达末页"判断——不对称是 bug 温床）。旧测试
  "翻到末页触发 onReachEnd"固化了错误行为，修复时同步改测试。
- 下次：翻页/边界类逻辑，先明确"到达边界"与"越过边界"的语义
  差异，再写条件与测试。

### 3.32 测量容器与渲染容器尺寸必须一致（2026-08-16）
- 场景：用户报"一页要下拉才看全"。分页测量用 clientHeight 作
  页高，但渲染 slice 有 `padding: 4px 10px 76px`（垂直 80px）+
  `max-width: 46em`——测量高度/宽度与真实可用内容区不一致 →
  每页内容超高 80px → 必须滚动。
- 认知：**隐藏测量容器（.m-p）的样式必须与渲染容器完全一致**
  （padding/max-width/box-sizing），页高还要扣除垂直 padding，
  否则"测得下、渲染不下"。真实浏览器验证（Edge headless）确认
  300px 容器扣 80px 后 30 页 vs 之前 20 页（内容超高）。
- 下次：任何"测量驱动布局"（分页/截断/自适应），测量样式与
  渲染样式共用一份常量；用真实浏览器验证"每页内容不超高"。

### 3.33 详情页返回后浏览状态丢失：卸载即失忆（2026-08-16）
- 场景：用户报"详情页返回后又要重新选择分类"。App 用 state 栈
  导航，进入 sourceBook/reader 时 ExplorePage/DiscoverPage 被
  **卸载**，返回时重新挂载 → 内部 state（选中分类、书籍列表、
  搜索词、搜索结果）全部归零。
- 认知：React state 栈导航下，**任何"离开即卸载"的页面内部状态
  默认都会丢**，除非显式持久化。修复：模块级会话缓存
  `navCache.ts`（Map<sourceId, 浏览快照> + 发现页快照），挂载时
  恢复、操作成功时保存；恢复前校验"分类仍存在于书源当前分类
  列表"（规则可能已变，失效则不恢复）。
- 下次：凡是"详情页/阅读页 → 返回"的场景，都要问"返回后页面
  现场是否还在"；页面级浏览现场（分类/搜索/列表/页码）统一走
  会话缓存恢复，避免逐页重做。模块级缓存会跨测试泄漏，组件
  测试必须 beforeEach 重置。

### 3.34 全局 Esc 分级：面板优先，其次退出阅读（2026-08-16）
- 场景：用户要求"esc 要可以直接退出阅读"。原实现阅读页 Esc
  只关面板（App 全局 Esc 显式跳过 reader/sourceReader）。
- 认知：**Esc 是"逐级后退"键**：面板开着先关面板，面板没开才
  退出当前页。退出前还要主动 persist() 保存进度（800ms 防抖
  可能未触发，直接卸载会丢最后章节切换）。键盘 handler 依赖
  数组要带上 panel/persist/onBack。
- 下次：改键盘行为时想清楚层级语义（面板 < 页面 < 全局），
  退出型操作前先落盘进度；测试覆盖"面板开/关"两种分支。

### 3.35 详情页参考原版：头图区 + 信息标签 + 可展开简介（2026-08-16）
- 场景：用户要求"书籍信息参考原版"（legado 详情页）。
- 认知：legado 详情页 = 封面背景模糊头图区（前景封面+书名+作者）
  + 状态/字数/更新时间标签行 + 可展开简介 + 操作行 + 章节列表。
  引擎侧 ruleBookInfo 只解析了 name/author/intro/coverUrl，参考
  原版还需 kind/wordCount/lastChapter/status/updateTime 五字段。
- 坑：jsdom 无真实布局，`clientHeight/scrollHeight` 恒为 0 →
  简介"是否超 3 行"的测量判断失效，展开按钮永不显示。测试用
  `Object.defineProperty(HTMLElement.prototype, ...)` getter 按
  class 区分 mock 尺寸，用后 delete 恢复。
- 下次：做"参考原版"的 UI 时先列出原版信息字段清单，引擎解析
  与 UI 展示一次到位；jsdom 测布局类判断要 mock 尺寸属性。

### 3.36 头图区无封面时白字不可读（2026-08-16）
- 场景：详情页头图区前景文字固定白色 #fff，但无封面时背景用
  主题浅色变量 → 浅色底白字看不见（很多源没有 coverUrl）。
- 认知：**头图区文字若固定白色，背景必须不依赖主题明暗**——
  用固定深色渐变兜底（`#2e3440 → #1a1d23`），有封面时被模糊
  背景图覆盖，无封面/图失败时兜底可见。封面 img 加载中/占位
  块也要半透明白（`rgba(255,255,255,0.12)`）而不是主题浅色，
  否则深色底上出现亮块。
- 下次：设计"前景白字 + 背景图"结构时，所有背景层（含兜底、
  占位、加载态）都要检查是否在无图路径下保持白字可读。

### 3.37 长目录默认折叠（2026-08-16）
- 场景：用户报"目录没必要列举这么多"。详情页一次性渲染全书
  目录（几百上千章），滚动极长。
- 认知：参考原版 legado——长列表默认折叠，只列前 N 章
  （TOC_PREVIEW=20）+「展开全部 N 章」/「收起」按钮。展开状态
  是页面内 state，返回后重挂载默认折叠（符合"默认少展示"的
  预期；分类浏览现场才由 navCache 恢复）。
- 下次：任何"长列表"（目录/书源列表/搜索结果）先问"默认展示
  多少 + 是否要展开按钮"，再谈渲染性能优化。
