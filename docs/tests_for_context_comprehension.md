# 如何模仿本仓库 `tests` 体系为你的项目写测试：原理与思路

> 目标读者：希望**对齐 ArkTaint-Part2 的测试分层与资产组织方式**，给自己或团队项目设计可维护回归的人。  
> 本文讲**原理与套路**，不替代具体命令行参数说明（见根目录 `README.md`、`docs/cli_usage.md`）。

**与本仓库的关联（请先读权威索引）：**

- **`tests/` 下各子目录职责与 manifest 分组**：以 [`tests/README.md`](../tests/README.md) 为准（本文不逐条复制，避免两处漂移）。
- **清单文件放置规则**：[`tests/manifests/README.md`](../tests/manifests/README.md)。
- **测试代码（驱动与断言）所在布局**：[`src/tests/README.md`](../src/tests/README.md)。

---

## 1. 核心原理：三层分离

本仓库把「测什么」拆成三块，避免混在一起后无法扩展、无法并行、无法在 CI 里分级执行。

| 层级 | 放什么 | 在本仓库中的位置 | 原则 |
|------|--------|------------------|------|
| **测试资产** | 语料、规则片段、manifest、基准期望 | `tests/`（`demo/`、`rules/`、`manifests/`、`fixtures/` 等） | **只读、长期保存**；运行产物**不准**写回这里 |
| **测试代码** | 驱动脚本、断言、共用 harness | `src/tests/**`（编译到 `out/tests/**`） | 与产品代码同源、可 TypeScript 类型检查 |
| **运行产物** | 报告、日志、中间 JSON | `tmp/test_runs/...`（或 `output/runs/...`） | **可删、可对比、可归档**；路径稳定便于 CI 缓存与 diff |

**想法**：先固定「资产目录」与「输出目录」的合同，再写测试；否则测试一多就会出现「临时文件散落仓库」和「复现不了」的问题。

---

## 2. 两种互补的测试形态

### 2.1 Manifest / 清单驱动（集成与回归）

**原理**：用一份 **manifest**（`.list`、`.json`）描述「要跑哪些 case、从哪棵目录选样、边界与期望怎么分桶」。测试程序只负责：**读清单 → 遍历 → 调 CLI 或 API → 聚合结果**。

**在本仓库的体现**：

- `tests/manifests/datasets/*.list`：数据集子集（dev / holdout 等）
- `tests/manifests/real_projects/*.json`：真实工程 smoke
- `tests/manifests/benchmarks/*.json`：基准组合与期望（如 `arktaint_bench.json`）

**优点**：

- 加 case 往往**只改数据与清单**，少改代码
- 同一 harness 可跑「全量 / 抽样 / 门禁子集」（`--k`、`--maxEntries` 等）

**适合你项目的模仿方式**：

1. 建 `your-project/tests/manifests/<用途>/`，按用途分子目录（datasets、integration、perf），**不要**全部堆在根目录。  
2. 约定 manifest 的 schema（哪怕先是 README + 一个 JSON 示例）。  
3. 写一个 **runner**：`node out/tests/your_domain/run_with_manifest.js --manifest ...`，退出码非 0 即失败。

### 2.2 单元 / 契约测试（确定性、快）

**原理**：不拉起完整「仓库级」分析，只对**单一模块**输入固定数据结构，断言输出或不变量。

**在本仓库的体现**：

- `src/tests/runtime/test_layer_dependency_gate.ts`：分层依赖白名单
- `src/tests/tools/test_context_skills_tooling.ts`：工具链确定性、预算行为
- 各类 `test_*_contract.ts`：契约与治理

**优点**：跑得快、失败定位准、适合 **CI 第一层门禁**。

**适合你项目的模仿方式**：

1. 把「必须永远为真」的规则写成小测试（解析器、序列化、纯函数、状态机）。  
2. 需要 **确定性** 的（例如压缩、摘要、哈希）：固定时钟或固定随机种子，断言多次运行一致。

---

## 3. 本仓库在 `tests/README.md` 里强调的约定（建议照搬思想）

以下与 [`tests/README.md`](../tests/README.md) 一致；若将来有冲突，**以 `tests/README.md` 为单一事实来源**，本文应随其更新摘要。

1. **`tests/` 只存长期资产**，运行时输出一律进 `tmp/test_runs/...`（或你项目里等价目录）。  
2. **Manifest 分组**：datasets / real_projects / benchmarks / … 各归其位，避免「扁平化」后难以检索（细则见 [`tests/manifests/README.md`](../tests/manifests/README.md)）。  
3. **基准与对照**：若有历史基线（本仓库的 senior synthetic、`HarmonyBench`），单独说明其地位，避免被误删。  
4. **npm 脚本作为入口**：`package.json` 里 `test:...`、`verify` 组合 = 团队共识的「门禁层级」，而不是让每个开发者记一长串路径。

---

## 4. 正式套件（Formal Suite）思想：可读的「测完即交付」

`src/tests/README.md` 描述了 **Formal Test Suite** 模式：**run.json / summary.json / report.json / report.md** 等标准产物，让人类与自动化都能在不读源码的情况下理解「测了什么、过没过、失败在哪」。

**想法**：若你的项目对外部团队或内部平台暴露结果，不要只 `console.log`；至少输出一份 **机器可读的 summary + 人可读的 report**，后续接 CI、看板、LLM 复盘都省力。

---

## 5. 给你项目落地时的推荐顺序（实操）

1. **选一条最痛的路径**（例如：CLI 一条命令、或核心 API 一次调用）。  
2. **固定最小资产**：1～3 个最小输入 + 期望（通过/失败均可）。  
3. **写最快失败的测试**：单元优先；若必须端到端，再写 manifest + runner。  
4. **约定输出目录**，在 `.gitignore` 里忽略运行产物（若尚未忽略）。  
5. **在 CI 里分两级**：`verify-fast`（单元+契约）与 `verify-slow`（清单全量或 nightly）。  

这与本仓库「`verify` 主门禁 + `verify:dev` 带 smoke」的哲学一致：不是一次跑完所有，而是**分层**。

---

## 6. 性能类测试怎么放进同一套哲学里

性能不是「多跑几次感觉慢」，而是单独一类 **契约**：

- **确定性优先**：同一输入多次结果一致（本仓库 `test:kernel-guard` 思路）。  
- **耗时**：用 **中位数 / P95** 对比基线，或单独 job，避免共享 CI 机器抖动误杀。  
- **资源**：大仓库场景记录峰值内存或 OOM，作为 manifest 中的一档「压力 case」。

与功能测试共用同一套：**资产在 `tests/`、脚本在 `src/tests/`、结果在 `tmp/test_runs/`**，只是在 report 里多写 `duration_ms`、`heap` 等字段。

---

## 7. 小结：模仿本仓库时最值得带走的 4 件事

1. **资产 / 代码 / 产物** 路径分离，写进 README 或贡献指南。  
2. **Manifest 驱动** 集成测试，**单元测试** 守内核不变量。  
3. **npm 脚本** 表达门禁层级，而不是口口相传命令。  
4. **标准报告产物**（哪怕极简）让失败可交接、可自动化消费。

按上述方式为你的项目搭好「骨架」后，再往里填 case，成本会远低于从零散脚本堆起来的回归。

---

## 8. 本仓库中的落地目录（自定义 context / comprehension 资产）

与上下文压缩、Skills、会话理解相关的**自维护测试资产**（manifest、fixture、期望片段等）放在：

- **`tests/context_and_comprehension/`**（见该目录下 [`README.md`](../tests/context_and_comprehension/README.md)）

测试**代码**仍放在 `src/tests/**`；运行产物仍写入 `tmp/test_runs/...`，与第 1 节三层分离一致。

---

*文档版本：1.2（增加 `tests/context_and_comprehension/` 落地说明）*  
*路径：`docs/tests_for_context_comprehension.md`*
