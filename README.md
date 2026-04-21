<div align="center">

# ArkTaint

**面向 HarmonyOS (ArkTS) 的高精度静态污点分析框架**  
**High-Precision Static Taint Analysis Framework for HarmonyOS (ArkTS)**

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/language-TypeScript-3178C6.svg)](https://www.typescriptlang.org/)
[![HarmonyOS](https://img.shields.io/badge/platform-HarmonyOS-black)](https://developer.huawei.com/consumer/cn/harmonyos)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)

[简体中文](#简体中文) | [English](#english)

</div>

---

## 简体中文

### 📖 项目简介

**ArkTaint** 是一个专为 HarmonyOS / ArkTS 设计的高精度静态污点分析框架。它建立在 [ArkAnalyzer](https://gitcode.net/openharmony-sig/arkanalyzer) 强大的 IR、调用图和指针分析能力之上。不同于传统的单遍规则匹配工具，ArkTaint 致力于将以下三类复杂语义纳入统一的分析主线中：

- **Rules (规则)**：声明式的 Source / Sink / Transfer / Sanitizer 规则定义。
- **Modules (模块)**：针对复杂 API、异步状态与框架级语义的深度建模。
- **ArkMain (入口)**：精准恢复 HarmonyOS 框架托管入口、组件生命周期以及隐式宿主回调。

此外，ArkTaint 独创了一条完整的 **大语言模型 (LLM) 自动建模工作流**：

> `轻量级预分析` ➔ `上下文候选切片` ➔ `LLM 摘要与语义分类` ➔ `生成 Rules/Modules/ArkMain` ➔ `注入分析主线全量执行`

这条由 `analyze --autoModel` 驱动的工作流所生成的模型，不仅能实时参与当前上下文的诊断，还能打包为可复用的库（Model Pack），在日后其他项目中无缝加载。

### 🚀 项目状态

ArkTaint 已具备企业级静态分析引擎的完整工程能力：

- 🛠 **成熟的 CLI 工具链**：内置 `analyze` / `llm` / `semanticflow` 等命令行工具。
- 📦 **标准的资产管理**：基于 `src/models` 的统一定义和包管理结构。
- 🧩 **高扩展的建模平面**：Rules、Modules、ArkMain 三平面协同工作。
- 📊 **现代化的结构报告**：支持导出易于集成的标准结构化诊断结果。
- 🧪 **严苛的测试基准**：涵盖基础回归、运行时契约、精度/性能 Benchmark 及真实项目集成测试。

它正处于快速演进期，目前的开发重心从基础能力构建转向：“如何更稳定地推断陌生 API？如何最大化复用模型资产？如何确保复杂语义下引擎的确定性？”

### ✨ 核心技术突破

- **🕵️ ArkMain 入口级调度与恢复**  
  HarmonyOS 应用无全局单一 `main()`。ArkTaint 实现了深度的 Ability / Component 生命周期挂载、框架层回调与宿主隐式行为钩子的图解化整合，将这些离散节点组装为全局统一的分析根论域。

- **⚙️ PAG 驱动的污点演化系统**  
  底层分析逻辑构筑于高度可信的指针赋值图（PAG）与 Worklist 算法。不论是简易 Rules、复杂的 Modules 还是顶层 ArkMain，均是在此 PAG 上注入可解释执行语义，拒绝“推翻重套分析图”。

- **📚 统一的模块化仓库**  
  首创平级包结构 (`pack-id:rules+modules+arkmain`)。分析者可像引入 npm 包一样，一键按需启用或禁用某个项目的依赖分析模型组合（比如 `acme_sdk:rules`）。

- **🤖 LLM 驱动的自动化建模抽象 (SemanticFlow)**  
  突破传统静态扫描遇“盲区”阻断的困境。引擎自动定位未知调用点，执行精准的 AST 切片与 PAG 近邻挖掘，将其交由 LLM 进行结构化语义推理。产出结果是严格契约化的 Rules/ModuleSpec/ArkMainSpec，直接注入系统，杜绝幻觉干预主分析线。

### 🏗 体系架构

当前工程严格以 `src/models` 为中心进行资产的解耦：

```text
src/
├── cli/        # 命令行入口 (analyze / llm / semanticflow)
├── core/       # 分析内核引擎 (PAG 传播、规则/模块/ArkMain 驱动中心)
├── models/     # 统一模型资产仓库 (Model Catalog)
│   ├── kernel/ # Engine 级基础/内置模型
│   │   ├── rules/ & modules/ & arkmain/
│   └── project/# 项目/组件级高阶定制包
│       └── <pack-id>/ 
│           ├── rules/ & modules/ & arkmain/
├── plugins/    # 高级流程拦截/改写插件
├── tests/      # 覆盖各切面的分层测试套件
└── tools/      # 内置开发辅助工具集
```

- **kernel**: 默认装载分析。
- **project/<pack-id>**: 按需按包启用的复用资产层。

---

### 🚦 快速开始

#### 环境准备

- Node.js >= 18.0.0
- npm 包管理器

#### 安装与构建

```bash
npm install
```

仓库自带 `arkanalyzer/` 子工程；根目录 `npm install` 会通过 `postinstall` 自动执行 `npm install --prefix arkanalyzer`，以安装 `ohos-typescript` 等依赖（运行测试与 `tsc` 所必需）。若你禁用了 postinstall 或仍报 `Cannot find module 'ohos-typescript'`，请手动执行：

```bash
npm install --prefix arkanalyzer
```

然后：

```bash
npm run build
```

#### 工程验收与测试

运行主回归门禁以验证本地环境：

```bash
npm run verify
```

*其他专项测试可参阅 [测试与 Benchmark 体系](#-测试与-benchmark-体系)。*

---

### 💻 核心 CLI 使用指南

> 注：完整参数定义见 `src/cli/analyzeCliOptions.ts`、`src/cli/semanticflow.ts` 与 `src/cli/llm.ts`。下面只保留第一次上手最容易卡住的参数。

#### 1. 常规全量分析

最小必填参数：

- `--repo`：HarmonyOS 工程根目录。
- `--sourceDir`：待分析源码目录；可传多个并用逗号分隔。若省略，引擎会自动尝试 `entry/src/main/ets`、`src/main/ets`、`.`。
- `--model-root`：模型仓库根目录，通常直接传 `src/models`。

```bash
npm run analyze -- --repo D:/work/MyArkApp --sourceDir entry/src/main/ets --model-root src/models
```

常见补充参数：

- `--outputDir`：指定输出目录；不传时默认落到 `output/runs/analyze/<repo>/<timestamp>/`。
- `--enable-model`：启用某个模型包，例如 `acme_sdk` 或 `acme_sdk:rules+modules`。
- `--disable-model`：禁用某个模型包或平面。
- `--profile`：分析档位，支持 `default`、`fast`、`strict`。

#### 2. 配置 LLM Profile

ArkTaint 不绑定具体厂商，只要对方提供 **OpenAI-compatible HTTP API** 即可。第一次使用建议按下面三步做。

**步骤 A：先把 API Key 放到环境变量中**

PowerShell 当前会话示例：

```powershell
$env:ARKTAINT_QWEN_API_KEY="你的 API Key"
```

推荐用环境变量或 `--promptKey`，不要直接把 `--apiKey` 写进命令历史。

**步骤 B：写入一个可复用的 LLM profile**

下面是阿里云百炼 / Qwen 的一个完整示例：

```bash
npm run llm -- --profile qwen --baseUrl https://dashscope.aliyuncs.com/compatible-mode/v1 --model qwen3.5-plus --apiKeyEnv ARKTAINT_QWEN_API_KEY --minIntervalMs 2000 --timeoutMs 120000 --connectTimeoutMs 30000
```

如果你的平台给的是完整接口地址而不是 base URL，就改用 `--endpoint`；两者二选一即可。

最关键的参数含义：

- `--profile`：配置名，之后在分析命令里通过 `--llmProfile qwen` 选择它。
- `--baseUrl`：兼容 OpenAI 的基础地址，例如 `https://dashscope.aliyuncs.com/compatible-mode/v1`。
- `--endpoint`：完整请求地址；只在厂商不提供标准 base URL 时使用。
- `--model`：实际调用的模型名。
- `--apiKeyEnv`：从哪个环境变量读取 key。
- `--promptKey`：交互式输入 key，并安全写入 `~/.arktaint/secrets/<profile>.key`。
- `--apiKeyHeader` / `--apiKeyPrefix`：当厂商鉴权头不是默认 `Authorization: Bearer <key>` 时再改。
- `--minIntervalMs`：请求最小间隔，适合限流严格的平台。
- `--timeoutMs` / `--connectTimeoutMs`：总超时与连接超时。
- `--config`：改用自定义的 LLM 配置文件路径；默认是 `~/.arktaint/llm.json`。

如果你不想手写参数，也可以：

```bash
npm run llm -- --interactive
```

**步骤 C：检查配置是否生效**

```bash
npm run llm -- --show
```

这会打印脱敏后的配置，确认 `activeProfile`、`baseUrl`、`model`、`apiKeyEnv` 或 `apiKeyFile` 是否正确。

#### 3. LLM 自动化建模 (SemanticFlow)

当 LLM profile 配好之后，直接使用 `analyze --autoModel` 即可跑完整两阶段流程：

```bash
npm run analyze -- --autoModel --repo D:/work/MyArkApp --sourceDir entry/src/main/ets --model-root src/models --llmProfile qwen --publish-model my_project_pack --outputDir tmp/test_runs/my_app/latest
```

这里最重要的参数是：

- `--autoModel`：开启“轻量预分析 -> 切片 -> LLM -> 生成 rules/modules/arkmain -> 第二阶段全量分析”。
- `--llmProfile`：选择前面通过 `npm run llm` 配好的 profile。
- `--publish-model`：把这次生成的模型落到 `src/models/project/<pack-id>/`，后续别的项目可以直接复用。
- `--model`：只覆盖本次运行的模型名，不改动 profile 文件本身。
- `--llmConfig`：本次运行使用自定义 LLM 配置文件，而不是默认 `~/.arktaint/llm.json`。
- `--arkMainMaxCandidates`：限制 ArkMain 候选数量，控制入口建模开销。
- `--concurrency`：并发处理候选锚点数量；真实 API 调试时建议先用 `1`。

如果你只想看切片与建模，不跑第二阶段分析，可以直接用 `semanticflow`：

```bash
node out/cli/semanticflow.js --repo D:/work/MyArkApp --sourceDir entry/src/main/ets --llmProfile qwen --no-analyze --outputDir tmp/test_runs/semanticflow_only/latest
```

#### 4. 模型复用与颗粒度热插拔

模型包按 `pack-id[:rules+modules+arkmain]` 选择。最常见的两种用法如下：

```bash
# 启用整个模型包
npm run analyze -- --repo D:/work/MyArkApp --enable-model my_project_pack

# 只启用部分平面，同时显式关闭另一个平面
npm run analyze -- --repo D:/work/MyArkApp --enable-model my_project_pack:rules+modules --disable-model my_project_pack:arkmain
```

#### 5. 资产内省服务 (Inspection)

```bash
# 查看当前可用的模型包
npm run analyze -- --repo D:/work/MyArkApp --list-models

# 查看某个模型包加载后的 Modules
npm run analyze -- --repo D:/work/MyArkApp --enable-model my_project_pack --list-modules

# 追踪某个 Module 的解析结果
npm run analyze -- --repo D:/work/MyArkApp --trace-module my.custom.identifier

# 查看插件清单
npm run analyze -- --repo D:/work/MyArkApp --list-plugins
```

---

### 📉 产物规范体系

报告产出的落板机制如下：

**普通全量分析 (`analyze`)** 默认落仓至：
`output/runs/analyze/<repo-name>/<timestamp>/`
- `summary/summary.json` / `.md`: 顶层漏洞检出报表与链路总结。
- `diagnostics/*`: 引擎运行期调试断言与未建模 API 缺口日志。

**LLM 自动建模与 SemanticFlow** 运行时默认落仓至：
`tmp/test_runs/runtime/semanticflow_cli/latest/` (或通过 `--output` 重新指定)
- `session.json`, `rules.json`, `modules.json`, `arkmain.json`: 全局会话与三平面聚合产物。
- `run.json`, `analysis.json`: 原始分析元数据。
- `phase1/` / `final/`: 轻量级预分析及第二阶段全量分析的产物镜像。

---

### 🧪 测试与 Benchmark 体系

拥有逾 150 项微端点脚本把控各层质量：

| 命令分类 | 作用域靶向 |
| :--- | :--- |
| `npm run verify` | 面向 CI 等级的强制工程安全门禁 |
| `npm run test:rule-*` | 模型定义层合法性、约束加载治理验证 |
| `npm run test:entry-model:*` | ArkMain 组件级推导验证主轴 |
| `npm run test:analyze-auto-model`| CLI 与自动化建模驱动测试 |
| `npm run test:arktaint-bench` | Core-Engine 层面 Benchmark 探针 |

*验证产出的沙盒痕迹默认收集于 `tmp/test_runs/`。*

---

### 🤝 接入与贡献参考

我们高度鼓励社区遵循如下边界扩展与丰富能力网：

1. **优先使用 Rules**: 数据流/污点的显式流转端点，均应采取声明式的 source / sink / transfer。
2. **需要高级语法网使用 Modules**: 跨表面的联动API、特殊异步容器桥接、内部信道。采用 `ModuleSpec`。
3. **补充宿主侧视角使用 ArkMain**: 解构与构建复杂的框架层运行时路由树与生命周期节点。
4. **修改分析拓扑内核使用 Plugins**: 提供拦截挂载钩子 (e.g. `timer`, `auth-filter`)。

💡 **最小学习切入点**:
- 模块建模样例: `examples/module/demo-module/demo.ts`
- 逻辑截面插件样例: `examples/plugins/timer_and_filter.plugin.ts`

---

## English

### 📖 Introduction

**ArkTaint** is an enterprise-grade static taint analysis framework engineered specifically for HarmonyOS & ArkTS applications. Architected on top of [ArkAnalyzer](https://gitcode.net/openharmony-sig/arkanalyzer)'s IR, Pointer Analysis, and Call Graph layers, ArkTaint extends far beyond traditional rule-based scanners by unifying three complex planes of software semantics:

- **Rules**: Declarative configurations defining exact Sources, Sinks, Transfers, and Sanitizers.
- **Modules**: Deep API representation for framework-specific asynchronous behaviors, bridges, and cross-surface states.
- **ArkMain**: A precise orchestrator tracking HarmonyOS lifecycle events, implicit callbacks, and component entry graphs.

Additionally, ArkTaint pioneers an innovative **LLM Auto-Modeling Pipeline (SemanticFlow)**:

> `Lightweight Baseline Analysis` ➔ `Intelligent Slice & Context Fetch` ➔ `LLM Heuristic Extraction` ➔ `Rules/Modules/ArkMain Synthesis` ➔ `Full Taint Propagation`

Invoked via `analyze --autoModel`, this workflow empowers the engine to deduce runtime behaviors of unknown third-party APIs on-the-fly and save them as reusable **Model Packs** for future usage.

### 🚀 Status

ArkTaint brings heavy-duty pipeline infrastructure out of the box:

- 🛠 **Granular CLI Tooling**: Unified entry points through `analyze`, `llm`, and `semanticflow`.
- 📦 **Model Asset Standard**: A modular, easily deployable structure based out of `src/models`.
- 🧩 **Multi-Plane Execution**: Synchronization of Rules, Modules, and ArkMain against the core graph.
- 🧪 **Rigorous Validation Bounds**: Extensively benchmarked logic covering runtime contracts, precision boundaries, and regression constraints.

### ✨ Core Capabilities

- **🕵️ ArkMain: Restoring the Hidden Execution Root**  
  HarmonyOS apps lack a traditional deterministic `main()`. ArkTaint automatically detects, builds, and simulates execution timelines from Ability components, event binders, and asynchronous triggers, restoring the semantic execution bounds.
  
- **⚙️ PAG-Driven Taint Evolution**  
  Regardless of modeling through Rules, Modules, or ArkMain overrides, execution logic maps strictly onto deeply parsed Pointer Assignment Graphs (PAG). Analysis does not fall back to heuristic string-matching strings; it trusts the pointer context.

- **📚 Unified Model Pack Architecture**  
  Similar to Node Modules, Model Packs (`rules + modules + arkmain` definitions) are sandboxed cleanly within directories. Analysts can mount or pack modules globally or toggle semantic planes per-project instance.

- **🤖 LLM Semantic Automation**  
  ArkTaint utilizes semantic slices bridging AST context boundaries to query AI models via compatible API providers. The retrieved instructions strictly respect schema constraints, generating executable configuration planes injected iteratively back into the propagation queue.

### 🏗 Architecture 

The framework isolates structural core capabilities from knowledge representation models:

```text
src/
├── cli/        # Unified command-line interface logic 
├── core/       # Analysis engines (PAG mapping, Taint Propagator, Spec Resolvers)
├── models/     # Model Catalog Home
│   ├── kernel/ # Out-of-the-box base OS modeling definitions 
│   └── project/# Extension boundaries for specialized packages
│       └── <pack-id>/ 
│           ├── rules/ & modules/ & arkmain/
├── plugins/    # Pipeline interceptors/overrides plugins
├── tests/      # Large-scale hierarchical test gates 
└── tools/      # Developer utilities
```

---

### 🚦 Quick Start

#### Environment Setup

- Node.js >= 18.0.0
- npm standard toolkit

#### Installation & Build

```bash
npm install
```

This repo vendors `arkanalyzer/`. Root `npm install` runs `postinstall`, which installs that package (including `ohos-typescript`) via `npm install --prefix arkanalyzer`. If you use `--ignore-scripts` or still see `Cannot find module 'ohos-typescript'`, run:

```bash
npm install --prefix arkanalyzer
```

Then:

```bash
npm run build
```

#### Acceptance Tests

```bash
npm run verify
```

---

### 💻 CLI Usage Guide

*(For the full option surface, see `src/cli/analyzeCliOptions.ts`, `src/cli/semanticflow.ts`, and `src/cli/llm.ts`. The list below focuses on the parameters that matter most for first-time setup.)*

#### 1. Standard Analysis

Minimum required arguments:

- `--repo`: HarmonyOS project root.
- `--sourceDir`: source directory to analyze; may be comma-separated. If omitted, ArkTaint probes `entry/src/main/ets`, `src/main/ets`, and `.` automatically.
- `--model-root`: model catalog root, usually `src/models`.

```bash
npm run analyze -- --repo D:/work/MyArkApp --sourceDir entry/src/main/ets --model-root src/models
```

Useful additions:

- `--outputDir`: override the default report directory.
- `--enable-model`: enable a model pack such as `acme_sdk` or `acme_sdk:rules+modules`.
- `--disable-model`: disable a pack or a single plane.
- `--profile`: analysis preset, one of `default`, `fast`, or `strict`.

#### 2. Configure an LLM Profile

ArkTaint is provider-agnostic as long as the backend exposes an **OpenAI-compatible HTTP API**.

**Step A: put the API key into an environment variable**

PowerShell example:

```powershell
$env:ARKTAINT_QWEN_API_KEY="your-api-key"
```

Prefer `--apiKeyEnv` or `--promptKey`. Avoid passing `--apiKey` directly in shell history.

**Step B: create a reusable profile**

Qwen example:

```bash
npm run llm -- --profile qwen --baseUrl https://dashscope.aliyuncs.com/compatible-mode/v1 --model qwen3.5-plus --apiKeyEnv ARKTAINT_QWEN_API_KEY --minIntervalMs 2000 --timeoutMs 120000 --connectTimeoutMs 30000
```

Use `--endpoint` instead of `--baseUrl` only when your provider gives you a full request URL rather than a standard compatible base URL.

Key parameters:

- `--profile`: profile name later referenced by `--llmProfile`.
- `--baseUrl`: OpenAI-compatible base URL.
- `--endpoint`: full request URL if base URL mode is not available.
- `--model`: actual model identifier.
- `--apiKeyEnv`: environment variable containing the key.
- `--promptKey`: prompt for a key and store it in `~/.arktaint/secrets/<profile>.key`.
- `--apiKeyHeader` / `--apiKeyPrefix`: override the default `Authorization: Bearer <key>` format when needed.
- `--minIntervalMs`: minimum delay between requests.
- `--timeoutMs` / `--connectTimeoutMs`: request timeout controls.
- `--config`: use a custom LLM config file instead of the default `~/.arktaint/llm.json`.

Interactive setup is also available:

```bash
npm run llm -- --interactive
```

**Step C: verify the stored profile**

```bash
npm run llm -- --show
```

#### 3. Execution of LLM Auto-Modeling

Once the profile is configured, run the full two-phase pipeline with:

```bash
npm run analyze -- --autoModel --repo D:/work/MyArkApp --sourceDir entry/src/main/ets --model-root src/models --llmProfile qwen --publish-model my_project_pack --outputDir tmp/test_runs/my_app/latest
```

Most important arguments:

- `--autoModel`: enable the full pipeline from lightweight pre-analysis to final full analysis.
- `--llmProfile`: choose the profile created with `npm run llm`.
- `--publish-model`: persist generated rules/modules/arkmain into `src/models/project/<pack-id>/`.
- `--model`: override the configured model for this run only.
- `--llmConfig`: use a non-default LLM config file.
- `--arkMainMaxCandidates`: cap ArkMain candidate volume.
- `--concurrency`: candidate parallelism; start with `1` for real-provider debugging.

If you only want slice generation + LLM modeling without the second-stage full analysis, run SemanticFlow directly:

```bash
node out/cli/semanticflow.js --repo D:/work/MyArkApp --sourceDir entry/src/main/ets --llmProfile qwen --no-analyze --outputDir tmp/test_runs/semanticflow_only/latest
```

#### 4. Model Re-use & Assembly Check

Model packs are selected as `pack-id[:rules+modules+arkmain]`:

```bash
# Enable the full pack
npm run analyze -- --repo D:/work/MyArkApp --enable-model my_project_pack

# Enable selected planes only
npm run analyze -- --repo D:/work/MyArkApp --enable-model my_project_pack:rules+modules --disable-model my_project_pack:arkmain
```

#### 5. Inspection

```bash
# List available model packs
npm run analyze -- --repo D:/work/MyArkApp --list-models

# Inspect loaded modules
npm run analyze -- --repo D:/work/MyArkApp --enable-model my_project_pack --list-modules

# Trace a specific module
npm run analyze -- --repo D:/work/MyArkApp --trace-module my.custom.identifier

# List plugins
npm run analyze -- --repo D:/work/MyArkApp --list-plugins
```

### 📉 Artifact Structure

A standard analysis (`analyze`) dumps artifacts to `output/runs/analyze/<repo-name>/<timestamp>/`:
- **`summary.json/md`**: High-level exposure metrics mapping source-to-sink hits.
- **`diagnostics/*`**: Unregistered APIs warning logs and stack diagnostic output.

A full semanticflow execution (`--autoModel`) utilizes `tmp/test_runs/runtime/semanticflow_cli/latest/`:
- **`session.json`, `rules.json`, `modules.json`, `arkmain.json`**: Modeling results.
- **`run.json`, `analysis.json`**: Engine execution trace records.
- **`phase1/`, `final/`**: Mirrors of the first-stage extraction and the second-stage completed run.

---

### 🤝 Extending & Contributing

We advise users creating custom extensions to follow this prioritization model:

1. **Use Rules**: Easiest integration logic. Declarative JSON schema for sources/sinks.
2. **Use Modules**: Required when managing cross-surface calls or state carriers (`ModuleSpec`).
3. **Use ArkMain**: Only required to define top-level root configurations overriding application bootstrap events. 
4. **Use Plugins**: Solely for modifying the internal event pipeline structure logic.

💡 **Templates**:
- Demonstrational Module: `examples/module/demo-module/demo.ts`
- Demonstrational Plugin: `examples/plugins/timer_and_filter.plugin.ts`

---

## License

ArkTaint is distributed under the [Apache License 2.0](./LICENSE).  
Copyright © Contributors to the ArkTaint Project.
