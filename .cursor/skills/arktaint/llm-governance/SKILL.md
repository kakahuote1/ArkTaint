---
id: "arktaint/llm-governance"
title: "LLM Output Governance (ArkTaint)"
version: "0.1.0"
owners:
  - security
  - platform
triggers:
  - "LLM 生成规则"
  - "自动落盘"
  - "写回仓库"
  - "agent output"
quality_gates:
  - script: "test:rules"
    why: "任何规则落盘前必须保证 schema 校验可过"
references:
  - "docs/llm_context_skills_and_compression.md"
  - "docs/rule_schema.md"
---

## 目的

明确 LLM 产出进入仓库的边界与最小审计要求，避免“看起来合理但不可控”的隐性风险。

## 关键约束（必须遵守）

- **LLM 产出不能直接当事实**：所有规则语义必须由人类评审确认。
- **先证据后落盘**：没有最小可运行证据（demo/manifest/测试）就不允许合入。
- **只在允许目录写入**：默认只写 rules 与 docs；不要改动 lockfile、生成物、第三方依赖等。

## Procedure（最小闭环）

1. 把 LLM 输出拆成两块：

   - **建议**（自然语言）
   - **变更**（具体文件 diff）

2. 对“变更”先跑 schema 门禁：

```bash
npm run test:rules
```

3. 输出交接包（见 `context:pack`）：包含 Goals/Decisions/Open questions/Artifacts。
4. 评审通过后再合入。

## Stop conditions

- 变更触及 kernel 关键规则族且没有对应回归用例
- 变更需要新增 schema 字段/改变治理契约

