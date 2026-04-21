## Skills（长期可复用上下文）

这个目录存放**给 Agent/LLM 使用的“可执行知识”**（程序性记忆）：高频工作流、硬约束、质量门禁、失败排查路径等。

### 使用方式（推荐）

- **查看索引**：`docs/skills/registry.json`
- **校验 Skills（registry ↔ SKILL.md frontmatter、references 路径、`package.json` scripts、禁止正文 `\\n` 字面量等）**：

```bash
npm run skills:validate
```

（单测或子目录校验时可加 `--repo-root=<绝对路径>`。）

### 目录约定

- `docs/skills/registry.json`：Skills 注册表（id / 路径 / owners / triggers / quality gates）
- `.cursor/skills/arktaint/**/SKILL.md`：每个 skill 独占目录，入口文件固定为 `SKILL.md`

### 重要原则

- **一个 Skill 一个责任**：不要做“万能 SKILL.md”
- **引用而非粘贴**：大段 schema/设计文档请引用 `docs/*.md` 的权威来源
- **质量门禁必须可运行**：Skill 里引用的 `npm run ...` 脚本要在 `package.json` 存在

