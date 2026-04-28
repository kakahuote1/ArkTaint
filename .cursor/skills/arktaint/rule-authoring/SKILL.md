---
id: "arktaint/rule-authoring"
title: "ArkTaint Rule Authoring"
version: "0.1.0"
owners:
  - security
  - taint-analysis
triggers:
  - "新增规则"
  - "修改 rules"
  - "rule schema"
  - "kernel rules"
  - "project rules"
quality_gates:
  - script: "test:rules"
    why: "保证 JSON 规则满足 schema 与基础约束"
  - script: "test:rule-governance"
    why: "保证规则包治理/分层/契约一致"
references:
  - "docs/rule_schema.md"
  - "docs/module_development_guide.md"
---

## 目的

把“写/改 rules”这件事变成**可重复的流程**，减少靠记忆与口口相传。

## 输入（你需要提供/确认）

- **改动类型**：source / sink / transfer / sanitizer / project overrides
- **目标文件路径**：例如 `src/models/kernel/rules/**.rules.json` 或 `tests/rules/*.rules.json`
- **最小复现用例**：对应 demo 目录或 manifest（能跑通一条路径即可）

## Procedure（按顺序执行）

1. **定位规则层级**：是 kernel（通用）还是 project（特定项目）。不要把项目特例写进 kernel。
2. **按 schema 写最小规则**：优先做“能表达语义的最小集”，避免一次性堆很多字段。
3. **补最小回归证据**：能用现有 demo/manifest 覆盖就不要新建；必须新建时保持用例最小。
4. **跑质量门禁**（必须全绿）：

```bash
npm run test:rules
npm run test:rule-governance
```

## 常见失败与定位

- **schema 报错**：优先对照 `docs/rule_schema.md`，确认字段名、类型、必填项。
- **governance/分层报错**：通常是把规则放错目录或破坏了层间依赖；先看错误输出提到的路径与 layer 名称。

## Stop conditions（必须停下来）

- 规则语义不确定且会影响 kernel（可能造成大面积误报/漏报）
- 需要改动治理契约（例如引入新 kind / 新 layer）但没有明确评审结论

