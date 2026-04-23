## 上下文压缩 / 交接包（Context Pack）

这个目录配合 `npm run context:pack` 使用，用于把一次长会话/长任务压缩成：

- **Rolling Summary**：Goal / Constraints / Decisions / Open questions / Next actions / Hypotheses
- **State Block**：结构化 JSON（可机器读、可复制粘贴续聊）

### 快速开始

1) 复制一份 State Block（示例见 `docs/context/state_block_example.json`）并按任务填写。  
2) 可选：准备一个“原始笔记/聊天摘录”文本（示例见 `docs/context/raw_notes_example.txt`）。  
3) 生成交接包：

```bash
npm run build
npm run context:pack -- --state docs/context/state_block_example.json --raw docs/context/raw_notes_example.txt
```

可选参数（与 `docs/llm_context_skills_and_compression.md` 第 4.7 节一致）：

- **`--max-chars=<n>`**：输出 Markdown 的最大字符数；超限时按固定优先级裁剪（Rolling Summary 列表尾部 → Artifacts → State Block 全量 JSON → 仅保留 `goal` / `constraints` / `active_skills` 的降级块）。
- **`--generated-at=<ISO8601>`**：固定时间戳，便于**同一输入多次运行**得到可比对、可哈希的确定性输出（测试与 CI 推荐）。

示例：

```bash
npm run context:pack -- --state docs/context/state_block_example.json --max-chars=4000 --generated-at=2026-04-21T00:00:00.000Z
```

输出默认写到：

- `tmp/test_runs/_context/latest/context_handoff.md`
- `tmp/test_runs/_context/latest/context_pack.json`

### 设计意图（为什么这样能“记得住”）

- **把不稳定的自然语言对话折叠成稳定字段**（State Block）→ 续聊时不容易丢约束
- **把重复工作流固化到 skills**（见 `docs/skills/registry.json`）→ 续聊时只需引用 skill id

