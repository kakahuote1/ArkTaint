# Phase 5.8 结构治理摘要

## 1. 模块职责
- `src/cli/**`：
  - `analyze.ts` 仅负责入口参数与调用。
  - `analyzeRunner.ts` 负责分析编排。
  - 参数解析/增量缓存/报告渲染拆到独立模块，避免入口堆积。
- `src/core/TaintPropagationEngine.ts`：
  - 只保留编排与对外 API，不承载大段规则匹配细节。
  - source/sink 匹配、debug 导出能力下沉到 `src/core/engine/**`。
- `src/core/engine/**`：
  - 承载可复用算法模块（source seed 收集、sink 签名解析、debug 导出等）。
- `src/tests/helpers/**`：
  - 承载测试脚本复用能力（进程执行、CLI 运行器、smoke/compare 共享逻辑）。

## 2. 拆分边界
- 可下沉：
  - 纯函数逻辑（匹配器、解析器、报告渲染器、脚本桥接层）。
  - 与主流程低耦合、可复用的工具代码。
- 不可下沉（保持在编排层）：
  - 对外 API 的主入口行为。
  - 依赖当前对象状态且跨模块副作用强的流程控制代码（除非先抽象接口）。

## 3. 结构门禁规则
- 命令：`npm run test:structure`
- 当前门禁检查：
  - 文件超限检查（默认阈值 `>600` 行，支持存量白名单）。
  - 测试目录重复大函数检查（按函数体哈希，跨文件检测）。
  - 测试脚本直接进程调用越界检查（限制 `spawnSync` 的直接使用）。
- 日常入口：
  - `npm run verify:dev = verify + test:smoke + test:structure`
  - 不替代 `npm run verify`，用于开发期结构与稳定性联合门禁。

## 4. 白名单治理原则
- 白名单仅用于“已登记存量问题”，不能掩盖新增问题。
- 新增超限/重复/越界项必须先修复，再允许通过。
- 白名单项需在 `task.md` 与 `verification_records.md` 留痕，并持续压缩。

## 5. 提交前最低检查
- `npm run build`
- `npm run verify`
- `npm run test:smoke`
- `npm run test:structure`
