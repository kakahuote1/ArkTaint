# 结构治理说明（已弃用旧门禁）

本文档用于声明：原“行数/白名单结构门禁”（`test:structure`）已移除。

移除原因：
- 行数与代码质量不等价；
- 白名单持续膨胀会削弱门禁可信度；
- 对开发期（特别是 Phase 7/8）造成不必要摩擦。

当前治理口径：
1. 硬门禁：
   - `npm run verify`
   - `npm run verify:generalization`
   - `npm run test:smoke`
2. 结构质量控制：
   - 以 `internal_docs/task.md` 的执行纪律为准；
   - 坚持“功能驱动重构”，不做行数驱动的强拆。

若本文档与 `internal_docs/task.md` 冲突，以 `internal_docs/task.md` 为唯一准则。
