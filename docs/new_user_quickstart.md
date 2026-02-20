# ArkTaint 新手三步上手（无 LLM）

本文档面向首次使用者，目标是：在**不修改 `src/core/**`** 的前提下，对新 ArkTS 项目完成一次可复现分析。

## 0. 前置条件

- 已安装 Node.js（建议 18+）
- 已在仓库根目录执行过：

```bash
npm install
npm run build
```

## 1. 第一步：生成项目规则草稿

```bash
npm run generate:project-rules -- --repo <你的项目路径> --output rules/project.rules.json
```

示例（Windows）：

```bash
npm run generate:project-rules -- --repo D:\projects\MyArkApp --output rules\project.rules.json
```

说明：
- 这一步会生成候选 `source/sink/transfer` 规则草稿。
- 后续只需要修改 `rules/**`，不需要改引擎代码。

## 2. 第二步：执行分析

```bash
npm run analyze -- --repo <你的项目路径> --project rules/project.rules.json --outputDir tmp/analyze/my_project
```

说明：
- `analyze` 会自动尝试发现源码目录（如 `entry/src/main/ets`、`src/main/ets`、`.`）。
- 分析结果默认输出：
  - `tmp/analyze/my_project/summary.json`
  - `tmp/analyze/my_project/summary.md`

## 3. 第三步：按报告建议补规则并重跑

打开 `summary.md`，重点看 `## 下一步建议`：
- `命中规则（Top）`：当前哪些规则在起作用；
- `未命中原因（Top）`：为什么没有形成更多污点流；
- `建议补规则位点（Top）`：优先补哪些 source/transfer 规则。

修改 `rules/project.rules.json` 后，重复第二步即可完成迭代闭环。

---

## 常见失败与修复

1. 报错：`repo path not found`
- 原因：`--repo` 路径错误。
- 修复：确认路径存在，建议先用绝对路径。

2. 报错：`no sourceDir found. pass --sourceDir`
- 原因：项目目录不在默认自动发现路径。
- 修复：显式传入源码目录，例如：
  - `--sourceDir entry/src/main/ets`

3. 报错：`Default rule file not found`
- 原因：默认规则文件缺失或路径错误。
- 修复：检查 `rules/default.rules.json`，或显式传：
  - `--default <规则路径>`

4. 报告 `withFlows=0`，但你认为应有结果
- 原因：source/sink/transfer 规则不足。
- 修复：先看 `summary.md` 的“未命中原因（Top）”，按建议补 `rules/project.rules.json` 再重跑。

5. 报告里出现 `status=exception`
- 原因：入口方法或语义解析异常。
- 修复：先缩小入口范围重跑（`--entryHint/--include`），再根据异常入口定位具体方法。

---

## 最短 3 步总结

1. `generate:project-rules` 生成项目规则草稿  
2. `analyze --repo --project` 执行分析  
3. 依据 `summary.md` 的“下一步建议”补规则并重跑

