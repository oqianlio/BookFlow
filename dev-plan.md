# 枕书下一阶段开发计划

日期：2026-08-28
状态：待开始
依据：docs/reevaluation-report-2025-08-16.md（剩余技术债清单）+ docs/plan.md 待续项
基线：前端 569 通过 / 0 失败（npm test 实测）；上一轮 P1 引擎补齐（变量四层 scope、URL 选项剥离、evalJs 扩展）已交付

## Goal

清偿再评估报告确认的真实技术债（删除级联、read_log、httpGet 签名），落定已完成的引擎拆分，并条件性推进书源复验——使项目保持「可放心继续演进」状态。

## Tasks

- [ ] 1. 提交工作区遗留改动：按逻辑分组提交引擎模块化拆分（bookSourceEngine.ts → bookSourceEngine/ 7 模块）、db/net/tts/cookies 复审修复、6 份评审文档 → Verify: `git status` 干净，`npm test` 仍 569+ 绿
- [ ] 2. `delete_source` 级联清理（`src-tauri/src/db.rs:482`）：删源时同步清理 `chapter_cache`、`reading_stats`、`shelf_source_books` 中该源的行 → Verify: cargo test 新增用例断言删源后三表无孤立行
- [ ] 3. `today_seconds` 精确化（`db.rs:850` 已有 TODO）：新增 `read_log(source_id, book_url, day_ts, seconds)` 表，阅读计时写增量，仪表盘按日聚合 → Verify: cargo test 覆盖按日聚合；设置页「今日时长」不再包含书籍生命周期累计
- [ ] 4. `httpGet` 改选项对象（`src/services/api.ts:85`）：签名改为 `{ url, headers?, timeoutMs?, method?, body?, contentType?, cookieJar? }`，迁移全部调用点，消除 `undefined` 串 → Verify: `npx tsc --noEmit` 0 错误，`npm test` 绿
- [ ] 5. 删除死代码守卫（`src/pages/ReaderPage.tsx:353` 恒真条件）→ Verify: diff 为单行删除，阅读预加载行为不变（手动翻章验证）
- [ ] 6. 消除 services 剩余 ~10 处 `any`（集中在 `fixtures.ts` / `bookSourceImport.ts` 解析中间态）→ Verify: services 目录 `grep -c ': any'` 归零，tsc 0 错误
- [ ] 7. README「已知限制」补安全说明：书源 `@js:` 在渲染进程执行（依赖 `unsafe-eval`），只应导入可信书源 → Verify: README diff 可见该条目
- [ ] 8. P0 书源复验（条件任务，依赖站点/限流恢复）：丁丁、来读读小说、悠久小说org、梦书中文逐一复测；「目录空」源按健康基线逐个排规则缺口 → Verify: docs 健康基线数字更新（当前 75/96、36/55、28/36 只升不降）
- [ ] 9. 收尾全量验证：`npm test` + `cargo test` + `npm run build` 全绿，打一个 Windows 包冒烟 → Verify: 三命令 exit 0，安装包可启动并打开一本本地书

## Done When

- [ ] 工作区干净，全部改动已按逻辑提交
- [ ] 再评估报告 P1 三项（级联清理 / read_log / httpGet）全部落地且有测试
- [ ] P2 快赢项（死代码、any、README）完成
- [ ] 两套测试套件 + 构建全绿

## Notes

- 顺序建议：1 → 2 → 3（同在 db.rs，串行）→ 4（独立，量大）→ 5/6/7（小项可穿插）→ 8（网络条件满足时随时插入）→ 9。
- 任务 2/3/4 相互独立，任务 8 依赖外部站点恢复，不被阻塞时可先做 4。
- Backlog（本轮不做）：大文件再治理（ruleExtractor.ts 1010 行 / LibraryPage.tsx 940 行，可维护性尚可）、工具栏实测反馈（等用户反馈量）、ReaderPage.test 对内部全局的解耦。
- CSP `unsafe-eval` 维持设计取舍，不在本轮修改（legado `@js:` 固有依赖）。
