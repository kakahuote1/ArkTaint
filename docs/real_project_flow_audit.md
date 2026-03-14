# Phase 7.9.3 真实项目 Flow 真实性与安全价值审计

## 1. 审计范围与口径
- 输入报告：`tmp/phase43/smoke_report.json`（`generatedAt=2026-03-03T04:52:01.154Z`）。
- 复现实验命令：
  - `npm run test:smoke`
- 本轮口径：
  - `TP`：存在“外部可控数据 -> 安全敏感 sink”的可确认链路；
  - `FP`：仅命中语法/命名启发式，无法确认外部可控输入到敏感 sink。
- 风险分级：
  - `高价值`：可直接利用或高置信真实漏洞链；
  - `中价值`：链路真实性较高但利用条件较强；
  - `低价值`：样例/框架噪音、重复流、或仅工程语义数据流。

## 2. 流级审计明细（全部 current flows）

| Flow ID | Entry Signature | Sink Sample | 代码位点（证据） | TP/FP | 价值分级 | 判定理由 |
| --- | --- | --- | --- | --- | --- | --- |
| F1 | `@ets/pages/Index.ets: Index.build()` | `[sig:insert(] ... .insert(emp, db)` | `entry/src/main/ets/pages/Index.ets:366` / `:392` | FP | 低价值 | 污点来自 `callback:param`（`db/event`），属于回调形参传播；`insert` 为业务 DB 写入路径，未见外部可控输入直达。 |
| F2 | `@ets/pages/Index.ets: Index.%AM32$%AM30$build(unknown)` | `[sig:insert(] ... .insert(emp, db)` | `entry/src/main/ets/pages/Index.ets:366`（编译期 AM 闭包变体） | FP | 低价值 | 与 F1 同一业务语句的 AM 拆分函数，属于重复 flow，不新增安全事实。 |
| F3 | `@ets/pages/Index.ets: Index.%AM35$%AM33$build(unknown)` | `[sig:insert(] ... .insert(emp, db)` | `entry/src/main/ets/pages/Index.ets:392`（编译期 AM 闭包变体） | FP | 低价值 | 与 F1 同源；仅事务异常分支的 AM 变体重复命中。 |
| F4 | `@ets/BaseMapper.ets: BaseMapper.deleteById(...)` | `[kw:relationalStore] ... SqlUtils.deleteById(id)` | `rdbplus/src/main/ets/BaseMapper.ets:385` / `:386`；`rdbplus/src/main/ets/core/SqlUtils.ts:131` | FP | 低价值 | `id` 来自函数形参（`direct:param`），`sqlData` 来自 `source_like_name`；SQL 为参数化 `where id = ?`，不构成可确认注入链。 |
| F5 | `@ets/BaseMapper.ets: BaseMapper.getById(...)` | `[kw:relationalStore] ... SqlUtils.getById(id)` | `rdbplus/src/main/ets/BaseMapper.ets:257` / `:258`；`rdbplus/src/main/ets/core/SqlUtils.ts:61` | FP | 低价值 | 与 F4 同型：形参与命名启发式触发，SQL 参数化，缺少外部可控输入证据。 |

## 3. 汇总结论
- 当前 flows：`5`
- 人工标签：`TP=0`，`FP=5`
- 价值分级：`高价值=0`，`中价值=0`，`低价值=5`
- 结论：在当前真实项目 smoke 范围内，`flow 数上升` 不能直接等价为能力提升；需结合真实性与安全价值审计结果解释。

## 4. 主要误报模式（用于后续优化）
- 模式 M1：`callback:param/direct:param` 将框架回调形参或通用函数形参直接作为 source，易产生工程语义流误报。
- 模式 M2：`direct:source_like_name`（如 `sqlData`）触发命名启发式 source，未绑定外部输入证据。
- 模式 M3：ArkTS 编译期 `%AMxx$` 闭包函数造成同一业务语句重复 flow，需要在审计/展示层去重解释。
