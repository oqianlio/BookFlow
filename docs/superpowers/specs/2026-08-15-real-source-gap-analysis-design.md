# 真实书源规则缺口分析（健康检查驱动）设计文档

日期：2026-08-15
状态：已批准

## 1. 背景

书源规则引擎（`src/services/bookSourceEngine.ts`）按 legado 语法逐步实现，
每步独立提交。为判断「规则不足」而非「站点不可达」，建立了真实书源健康检查
（`src/services/sourceHealth.test.ts`，`SOURCE_HEALTH=1` 门控）：
对 274 个启用书源执行真实搜索（关键词 斗破苍穹），统计可用源并分类失败原因。

可用源数量演进：16 → 25 → 40 → 41 → 52 → 56 / 274。

## 2. 检查工具要点

- 书源导出：`src-tauri/src/bin/export_sources.rs` → `tmp_sources.json`（已 gitignore）。
- 并发 30 路，超时 8s；`SOURCE_NAME` 过滤单源调试。
- 响应解码：UTF-8（fatal）→ GBK 回退，与 Rust 侧 `decode_body` 一致。
- 必须正确转发 `method`/`body`（POST 搜索），否则 POST 源全部误报无结果。

## 3. 本轮修复的规则缺口（真实源验证）

| 缺口 | legado 语法 | 真实源验证 | 提交 |
|---|---|---|---|
| jsBlock 用 `src` 全局 | `src` = result 别名 | 找书神器：20 本 | 931686e |
| `source.getKey()` | source 对象方法 | 27姐姐（站点不可达） | 931686e |
| jsBlock 产出 `URL,{json 选项}` | `url="https://x/search/,"+JSON.stringify({method:"POST",body})` | 27姐姐 | 931686e |
| `java.base64Decode/Encode` charset | `java.base64Decode(pi,"gbk")` | 找书神器 | 931686e |
| jsBlock 返回值改写后续规则 result | `<js>…result=st;</js>\n$.book_list.*` | 找书神器：20 本 | 28b17f8 |
| 链式 `A@js:code`：result=Elements（toArray） | `class.v-list-item\n@js:…list1.map(x=>x)` | 随心看：15 本 | 741da16 |
| 链式段 `tag.X`（列表） | `class.librarylist@tag.li` | 快眼看书：100 本 | 3141181 |
| 链式段 `!N` 列表语义=跳过前 N 个 | `tbody@tr!1` / `.search@li!0`（跳表头） | 笔趣阁⑥：51 本 | 3141181 |
| bookList `&&` 合并多个列表规则 | `.search@li!0&&.gengxin@li&&.wanben@li` | 笔趣阁⑨：25 本 | 3141181 |

## 4. 已知不可行/非引擎问题（218 个失败源的分类）

- 74 fetch failed（不可达/需代理，多为 🪜 源）
- 64 无结果（站点确无此书、选择器过时、JS 渲染页）
- 31 超时、18 HTTP 403、11 HTTP 404、3 HTTP 521、5 响应过短
- `JavaImporter`（番茄小说 xGorgon 签名）：Rhino Java 互操作，TS 侧无法实现，
  需真实签名算法，判为不可行。
- 站点侧问题：GBK 编码搜索参数（三三言情）、API 参数约定（丁丁小说页码）、
  反爬（人人小说 Verify Yourself）、后端故障（BB成人小说 fsockopen）。

## 5. 后续候选缺口

- `##` 正则替换作用于节点 outerHtml（bookUrl 类规则 `##"…"###`）
- item 内链式规则（extractFromElement 内 A@B@C）
- `[-1]` 负索引（class.recommend[-1]）
