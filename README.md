<div align="center">

# 🛡️ ArkTaint

**面向 HarmonyOS (ArkTS) 的新一代深层静态污点分析引擎**  
**Advanced Static Taint Analysis Framework for HarmonyOS (ArkTS)**  

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/language-TypeScript-3178C6.svg)](https://www.typescriptlang.org/)
[![HarmonyOS](https://img.shields.io/badge/platform-HarmonyOS-black)](https://developer.huawei.com/consumer/cn/harmonyos)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)

[简体中文](#简体中文) | [English](#english)

</div>

---

## 简体中文

### 📖 项目简介

**ArkTaint** 是专为 HarmonyOS (ArkTS) 应用开发的高精度静态污点分析引擎。它构建在 [ArkAnalyzer](https://gitcode.net/openharmony-sig/arkanalyzer) 坚实的底层基础架构之上（充分利用其 IR、调用图机制与指针分析底座），并在此基础上突破性地引入了深度的框架语义级控制流恢复、基于 PAG (Provenance Analysis Graph) 的惰性数据流追踪，以及灵活且严谨的三维扩展隔离架构。

无论是用于大规模开源鸿蒙工程的安全漏洞扫描、对复杂的长时异步 API 行为进行语义建模，还是通过插件深层定制符合特定企业合规的分析流水线，ArkTaint 都能提供极其精准、低假阳性的分析支撑。

### 📌 项目状态

ArkTaint 当前已经具备完整的工程主线：可运行的 CLI、规则系统、模块系统、插件系统、主回归测试、基准测试以及结构化诊断输出。  
同时，它仍然是一个持续演进中的分析框架，而不是冻结不变的产品化 SDK。这意味着：

- 日常使用和扩展开发已经是第一等公民能力；
- 工程纪律已经明确；
- 但建模能力、基准覆盖和作者接口仍会继续迭代。

### ✨ 核心技术突破

相较于传统的“泛匹配”或“硬编码”类型的污点引擎，ArkTaint 解决了现代响应式声明 UI 框架和重度异步调度平台特有的痛点：

- 🎯 **框架感知的语义级入口恢复 (ArkMain 核心算法)**  
  在 HarmonyOS 中，不存在单一的 `main()` 入口。控制流碎片化散落在 `Ability / Component` 生命周期、UI 交互事件、系统调度器行为，乃至页面间 Router 与 Want 的唤起投递中。传统的 CG/PAG 对这些“隐式触发”完全盲视。  
  ArkTaint 摒弃了松散的字符串匹配启发式猜测，首创了 **ArkMain 算法**：它通过推断精确的 **Activation Contract**（激活契约：包含 owner, surface, trigger, phase, boundary 维度），找出合法的 Framework-managed Entry，并将这些散落的代码片段严格按时序物化出一个合成的根节点 (`@arkMain Synthetic Root`)，为后续分析奠定了绝对合规可溯的启动面。

- 🔄 **统一延后执行建模 (Unified Deferred Execution)**  
  传统分析引擎针对 Callback、Closure、Promise 会编写数十套“打补丁式”的遍历逻辑。ArkTaint 从理论模型层面进行了降维打击，设计了极简的 **Activation Handoff Contract** 模型。  
  通过将各类异步现象抽象为 `Semantic Kernel` 与 `Port Summary`，ArkTaint 完美统一了不同异步投递机制之间的数据交接，避免了全剧图泛洪，并全面依托于 PAG 的惰性求值策略 (Lazy Evaluation) 进行精确演算，达到计算性能与分析精度的极限平衡。

- 🌊 **基于工作表 (Worklist) 的纵深污点传播**  
  不满足于局部变量的数据流传递，ArkTaint 的分析指针具备跨越系统运行期的深厚穿透力：包含基础的 Local Value Flow 和对象状态演移 (Object State / Field Flow)；解决重度复杂的 ES6 高级容器追踪 (Array, Map, Set)；甚至支持应用层从局部组件经由 `AppStorage / LocalStorage / PersistentStorage` 全局响应式黑洞发生的数据污染逃逸追踪。

---

### 🏗 体系架构

ArkTaint 采用模块化分层防腐架构设计，确保了引擎的稳定性与纯粹性：

```text
src/
├── core/     # 🧠 分析内核、传播引擎、ArkMain Contract 推理总线、PAG 求值体系
├── rules/    # 📜 Builtin Default Rules (基于声明式的数据来源与终端点映射)
├── modules/  # 🛠 Builtin Semantic Modules (闭包桥接、生命周期调度、Router/Worker 等深度支持)
├── plugins/  # 🔌 Engine Plugins (自定义探察发现机制，运行期审计与观测)
├── cli/      # 💻 命令行执行驱动、结构化输出报告总装、系统诊断调试工具
├── tests/    # 🧪 涵盖架构防劣化门禁、Metamorphic 变异测试集、HapBench 集成跑道
└── tools/    # 🔧 内部研效工具与自动特征生成系
```

---

### 🚀 快速开始

#### 环境要求
- **Node.js** `>= 18`
- 确保可用环境拥有 `npm` 或 `pnpm` 包管理器。

#### 构建项目

```bash
npm install
npm run build
```

#### 工程防线回归与检查

开发周期内最核心的准入门禁。不仅会跑单元测试，还会执行系统运行期的契约审计（涵盖引擎架构、Module 规范与 ArkMain 入口一致性等）：

```bash
npm run verify
```

---

### 💻 核心 CLI 审计方案

提供高度可配的扫描入口（全量参数详见 [CLI Usage Guide](./docs/cli_usage.md)）。

**1. 基线项目扫描（仅拉起内置安全池）**
```bash
node out/cli/analyze.js \
  --repo <鸿蒙工程代码根目录> \
  --sourceDir entry/src/main/ets \
  --ruleCatalog src/rules
```

**2. 加装业务防护与自定义规则**
使用宿主特化的 Rules 与定制 Modules，对业务特定的敏感点与自研框架开展扫描：
```bash
node out/cli/analyze.js \
  --repo <repo> \
  --sourceDir entry/src/main/ets \
  --ruleCatalog src/rules \
  --project <自研项目.rules.json> \
  --module-root <特定模型加载目录> \
  --enable-module-project <projectId>
```

**命令行结构化输出解析：**
引擎生成的中间件与分析物会被按需生成：
- `run.json`: 当前任务引擎负载与耗时分发记录。
- `summary/summary.md`: 图文并茂的问题链路溯源 Markdown 报告。
- `summary/summary.json`: 面向程序与 AI 的结构化摘要，不阅读测试或源码也能理解这次分析的总体结论。
- `diagnostics/diagnostics.json`: 若您的扩展发生了语法或注册违规，该文件会产生具备精确定位的长篇建议（结构化错误码机制）。

**如果您第一次运行 ArkTaint，建议优先查看：**

1. `summary/summary.md`
2. `summary/summary.json`
3. `diagnostics/diagnostics.txt`

---

### 🧪 测试与 Benchmark 基准体系

ArkTaint 不将所有测试混入不可解释的单体应用，而是维护了极其庞杂且专项的测试沙盒。所有的跑测执行产物均沉淀于 `tmp/test_runs/...` 中，长跑时还会自动输出 `progress.json` 指标。

**常用测试入口矩阵：**

| 命令 | 作用 |
|------|------|
| `npm run verify` | 主工程回归，检查系统契约是否被打坏 |
| `npm run test:diagnostics` | Rules / Modules / Plugins 的报错定位与 inspection 回归 |
| `npm run test:arktaint-bench` | ArkTaint 主集成 benchmark |
| `npm run test:harmony-modeling` | Harmony 内建 modules 的专项建模 benchmark |

---

### 🔌 扩展与贡献指南

为应对日益膨胀的未知 API，ArkTaint 建立了极其严苛的工程纪律：**绝不对 Core Kernel 进行散装逻辑修补**。扩展能力被正交定义为三个位面。

#### 严谨的三维扩展架构 (弹性边界隔离)

- **Rules (配置规则)**: 用于低阶的声明式 Endpoint 传播表达，如标记某个入参为 Sink，定义某个 API 返回值为 Source，或是配置 Sanitizer 拦截网。
- **Modules (语义模块)**: 专用于弥合复杂调用，如强语义框架的调度桥接任务、特定 Event Emitter 的派发收敛，以及闭包或 Worker/TaskPool 层面的状态硬编码恢复。
- **Plugins (引擎插件)**: 允许深度侵入分析主流水线，可监听传播事件 (Propagation Observers)、注入自定发现逻辑机制，或执行定制化的结果收口与报表过滤。

#### 🧭 何时使用 Rules / Modules / Plugins

| 需求类型 | 推荐方式 |
|---------|---------|
| 只需要声明某个 endpoint 是 source / sink / transfer / sanitizer | **Rules** |
| 需要为某个 API、框架能力或 SDK 行为补语义逻辑 | **Modules** |
| 需要改变分析流程本身，如 entry、propagation、detection、result | **Plugins** |

#### 🧩 贡献建议

如果您准备为 ArkTaint 增加新能力，推荐遵循如下顺序：

1. 能用声明式 endpoint 语义表达的，优先写 **Rules**；
2. 需要针对具体 API 或框架补语义的，优先写 **Modules**；
3. 只有在需要改变分析流程本身时，才写 **Plugins**；
4. 只有在现有公开作者接口确实不够表达一类通用能力时，才考虑修改 **Kernel**。

如果您希望从最小样例入手，建议先看：
- `examples/module/demo-module/demo.ts`
- `examples/plugins/timer_and_filter.plugin.ts`

---

## English

### 📖 Overview

**ArkTaint** is an advanced, high-precision static taint analysis engine built specifically for HarmonyOS (ArkTS) applications. Operating atop the [ArkAnalyzer](https://gitcode.net/openharmony-sig/arkanalyzer) infrastructure (maximizing its capability for IR mapping, Call Graph construction, and root Pointer Analysis), ArkTaint sets entirely new benchmarks by pioneering deep, framework-aware control flow recovery, PAG-based lazy evaluation for robust data flow tracking, and adopting a highly disciplined three-dimensional extension architecture. 

Whether engaged in vulnerability hunting across immense OpenHarmony codebases, crafting intricate semantic modeling for opaque asynchronous endpoints, or seamlessly plugging in organizational compliance checks, ArkTaint offers uncompromised stability and precision.

### 📌 Project Status

ArkTaint already has a complete engineering backbone: a working CLI, rule system, module system, plugin system, primary regression lanes, benchmark lanes, and structured diagnostics.  
At the same time, it should still be understood as an actively evolving analysis framework rather than a frozen product SDK. In practice, this means:

- day-to-day usage and extension work are first-class workflows;
- engineering discipline is already enforced;
- modeling coverage, benchmark scope, and authoring surfaces continue to evolve.

### ✨ Deep Engineering Breakthroughs

Instead of relying on crude substring matchers or patchwork syntax handlers, ArkTaint directly resolves fundamental issues within modern reactive frameworks and asynchronous scheduling:

- 🎯 **Framework-Aware Semantic Entry Recovery (ArkMain Algorithm)**  
  In contemporary ArkTS code, control flows are massively fragmented—shattered across `Ability/Component` lifecycles, callback handlers, watcher event loops, scheduling timers, and `Want`/`Router` handoffs. Standard analyses remain blind to these disjointed invocations.  
  ArkTaint answers this by implementing the proprietary **ArkMain Algorithm**: rather than engaging in loose heuristic guessing, it identifies concrete *Framework-managed Entries* and deduces rigid **Activation Contracts** (mapped along owner, surface, trigger, phase, and boundary dimensions). It then synthesizes an irrefutable synthetic root pointer (`@arkMain Synthetic Root`), providing an uncompromising initiation phase for downstream parsing, bridging isolated closures back into a sequential timeline.

- 🔄 **Unified Deferred Execution Mapping**  
  Historically, analyzing `Callbacks`, `Closures`, and `Promises` resulted in vast quantities of scattered handler patches. ArkTaint eradicates this using theoretical refinement via the **Activation Handoff Contract**.  
  By abstracting all fragmented deferred evaluations into a uniform intersection of a `Semantic Kernel` and `Port Summary`, the engine gracefully manages data transitions. Integrated fully with PAG-based Lazy Evaluation logic, it accurately models continuation execution edges while virtually nullifying explosive edge generation and performance bloat.

- 🌊 **Worklist-Driven Penetrative Taint Propagation**  
  Moving past elementary logic, ArkTaint's worklist core is designed to persistently traverse deep local boundaries.  
  It navigates standard local value flows, intricate object state shifts, complex data topologies housed within ES6 native containers (Array, Map, Set bindings), and fully bridges state-reactive escapement mechanisms common in Harmony frameworks like AppStorage, LocalStorage, and PersistentStorage mutations.

---

### 🏗 Component Architecture

ArkTaint deploys a layered anti-corruption structural layout to isolate specific responsibilities:

```text
src/
├── core/     # 🧠 Core Kernel, Propagation Graph Matrix, ArkMain Bus, PAG evaluators 
├── rules/    # 📜 Builtin default schema layouts covering OS-level declarative patterns
├── modules/  # 🛠 Builtin semantic handlers for bridging asynchronous APIs & closures
├── plugins/  # 🔌 Custom engine plugins governing instrumentation, interception & audit
├── cli/      # 💻 Terminal runner, structured diagnostic formatter & audit tooling
├── tests/    # 🧪 Hardened CI pipeline gates, Metamorphic verifiers, & HapBench runner
└── tools/    # 🔧 Developer SDK generation and metric extraction tools
```

---

### 🚀 Rapid Start

#### System Requirements
- Environment equipped with **Node.js 18+**
- Node Package Manager (`npm` or `pnpm`)

#### Assembly

```bash
npm install
npm run build
```

#### Executing the Core Verification Gate

Considered mandatory ahead of contributing logic; checks the physical health of not only compilation tests but operational contract bounds, module hygiene, and ArkMain architectural persistence:

```bash
npm run verify
```

---

### 💻 Deep CLI Auditing

Delivers highly configurable targets (exhaustive metrics and configurations found via the [CLI Documentation](./docs/cli_usage.md)).

**1. Baseline Application Audit**
```bash
node out/cli/analyze.js \
  --repo <Local Repo Directory> \
  --sourceDir entry/src/main/ets \
  --ruleCatalog src/rules
```

**2. Amplified Security Assessment with Distinct Logic Imports**
Integrates unique company-bound intelligence and isolated behavior modeling capabilities over the runtime:
```bash
node out/cli/analyze.js \
  --repo <repo> \
  --sourceDir entry/src/main/ets \
  --ruleCatalog src/rules \
  --project <project.rules.json> \
  --module-root <directory path representing your structural model> \
  --enable-module-project <project target identifier>
```

**Expected Structural Telemetry:**
- `run.json`: Global operational metadata spanning pipeline payload usage.
- `summary/summary.md`: Highly narrative, graph-based markdown mapping pinpointing taint origins.
- `summary/summary.json`: Machine-friendly and AI-friendly structured output that explains the run verdict without requiring test or source inspection.
- `diagnostics/diagnostics.json`: Absolute precision engine warnings mapping syntactic violations occurring via your Rules or Code module additions against strict internal constraints.

**For a first-time run, start by opening:**

1. `summary/summary.md`
2. `summary/summary.json`
3. `diagnostics/diagnostics.txt`

---

### 🧪 Benchmarking Corridors

Refusing to entangle distinct features within monolith CI runners, ArkTaint houses distinct, isolated architectural evaluation sandboxes. *(Artifacts output dynamically per run sequence toward `tmp/test_runs/...` inclusive of the detailed `progress.json` traces indicative of extensive executions.)*

**Common test matrix:**

| Command | Purpose |
|---------|---------|
| `npm run verify` | Primary engineering regression |
| `npm run test:diagnostics` | Diagnostics and inspection regression for Rules, Modules, and Plugins |
| `npm run test:arktaint-bench` | Integrated ArkTaint benchmark |
| `npm run test:harmony-modeling` | Dedicated benchmark for builtin Harmony modules |

---

### 🔌 Extensibility & Contribution Guidance

ArkTaint establishes a fiercely policed engineering doctrine: **Never submit disparate, loose logic patches to the Core Kernel.** All expansions must abide by an orthogonal layout:

#### Disciplined Architectonic Extensions (Elastic Isolation boundaries)

- **Rules**: Used for zero-code declarative mapping (categorizing isolated endpoint signatures as Sources, Sinks, Transfers, or Sanitizers).
- **Modules**: Crucial for defining deep, semantic-level framework interventions (e.g., stitching fractured Event Emitter handovers, hardcoding `Worker/TaskPool` context bridges, or state continuations).
- **Plugins**: A raw avenue into the central pipeline itself—enabling interceptors acting as Propagation Observers, injecting radical discovery routines, and manipulating output logic sets.

#### 🧭 When to Use Rules / Modules / Plugins

| Need | Recommended Surface |
|------|---------------------|
| You only need to mark a source, sink, transfer, or sanitizer endpoint | **Rules** |
| You need semantic logic for a concrete API, framework feature, or SDK | **Modules** |
| You need to change the analysis pipeline itself | **Plugins** |

#### 🧩 Contribution Guidance

If you plan to extend ArkTaint, the preferred order is:

1. use **Rules** when declarative endpoint semantics are enough;
2. use **Modules** when a concrete API or framework semantic must be modeled;
3. use **Plugins** only when the analysis workflow itself must change;
4. evolve **Kernel** only when the public authoring surface is fundamentally insufficient.

Useful starting points:
- `examples/module/demo-module/demo.ts`
- `examples/plugins/timer_and_filter.plugin.ts`

---

### 📄 Licensing Directives

ArkTaint operates proudly beneath the [Apache License 2.0](./LICENSE).  
Copyright © Contributors to the ArkTaint Project.
