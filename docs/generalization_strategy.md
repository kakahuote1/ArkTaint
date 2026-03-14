# ArkTaint 泛化验证策略（Phase 4）

## 1. 目标与范围
- 目标 1：证明能力不是仅对 `senior_full` 测试集有效。
- 目标 2：建立可复现、可比较、可追踪的泛化门禁。
- 目标 3：为后续 Phase 5 能力补全提供归因输入。

本策略覆盖四类验证：
- 分层验证：`dev` / `holdout`
- 变形验证：`metamorphic v1/v2/v3`
- 真实项目烟测：`smoke`
- 主线基线：`verify`（`k=1 230/230`）

## 2. 统一执行入口

基础门禁：
```bash
npm run verify
```

泛化门禁：
```bash
npm run verify:generalization
```

`verify:generalization` 会统一执行并聚合：
- `test:dev`
- `test:holdout`
- `test:metamorphic`
- `test:metamorphic:v2`
- `test:metamorphic:v3`
- `test:smoke`

## 3. 通过判定（Gate）

门禁通过需同时满足：
- `dev` 无失败（`failed=0`）
- `holdout` 无失败（`failed=0`）
- `metamorphic` 三套报告均无不一致（`inconsistentCount=0`）
- `smoke` 无致命项目失败（`fatal_projects=0`）
- `smoke` 主样本 `no_seed <= 20%`

并且保持基础基线：
- `npm run verify` 通过
- `k=1` 维持 `230/230`

## 4. 报告产物与路径

烟测报告：
- `tmp/phase43/smoke_report.json`
- `tmp/phase43/smoke_report.md`

标注报告：
- `tmp/phase43/smoke_labels_<date>.json`
- `tmp/phase43/smoke_label_summary_<date>.md`

泛化总报告：
- `tmp/phase44/generalization_report_<date>.json`
- `tmp/phase44/generalization_report_<date>.md`

## 5. 抽样标注与归因口径

抽样要求：
- 每轮样本 `>=20`
- 至少两轮可复现
- 可使用 `--excludeLabels` 做非重合抽样

标签口径：
- `TP` / `FP` / `Unknown`

归因口径：
- `entry_not_matched`
- `no_seed`
- `sink_not_covered`
- `missing_call_edge`
- `rule_missing`
- `other`

## 6. 当前基线（2026-02-14）

- `verify`：k=0 `229/230`，k=1 `230/230`
- `verify:generalization`：`overall_success=true`
- smoke：`projects=4`，`fatal=0`，主样本 `no_seed=6/36 (16.7%)`
- 变形一致性：v1 `16/16`，v2 `16/16`，v3 `14/14`

## 7. 失败处置流程

任一 Gate 失败时按顺序执行：
1. 固化失败产物到 `tmp/phase43` / `tmp/phase44`
2. 在 `verification_records.md` 记录失败现象、根因、修复计划
3. 回归验证：先 `npm run verify`，再 `npm run verify:generalization`
4. 未恢复前不推进下一阶段功能开发

## 8. 与后续阶段关系

- 本策略为 Phase 5 的优先级输入来源（依据 `smoke` 归因分布）
- Phase 6/8 的规则与插件能力必须复用此门禁，不允许绕过
