---
id: "arktaint/smoke-and-ci"
title: "ArkTaint Smoke & CI Triage"
version: "0.1.0"
owners:
  - ci
  - qa
triggers:
  - "smoke"
  - "real project"
  - "回归"
  - "CI 失败"
  - "test:smoke"
quality_gates:
  - script: "test:smoke:core"
    why: "核心真实项目集回归，能快速暴露规则/引擎回退"
references:
  - "docs/cli_usage.md"
  - "tests/manifests/real_projects/smoke_projects_core.json"
---

## 目的

把“smoke 挂了怎么定位”固化为最短路径，减少反复问答。

## Procedure（按顺序执行）

1. **确认失败范围**：是单个项目，还是普遍失败；记录失败项目名与入口（report/outputDir）。
2. **先跑核心 smoke**（作为基线）：

```bash
npm run test:smoke:core
```

3. **聚焦第一处断点**：优先看第一条失败用例，而不是被级联放大的后续错误。
4. **分类错误**（选一种路径继续）：
   - 规则 schema/治理错误 → 转 `arktaint/rule-authoring`
   - 结果对齐错误（sink inventory mismatch 等）→ 比较报告与预期、看涉及的 rule family
   - 运行时崩溃（异常、解析失败）→ 先定位到具体 sourceDir 与入口文件，再回溯引擎调用栈

## 产出（用于上下文压缩/交接）

请在会话 State Block 里至少记录：

- 执行的脚本名（例如 `test:smoke:core`）
- 失败的项目/用例标识
- 第一条关键错误（20 行内）
- 涉及的规则文件路径（若已定位）

