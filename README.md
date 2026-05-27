# ArkTaint

**面向 HarmonyOS / ArkTS 的静态污点分析框架**
High-precision static taint analysis for HarmonyOS and ArkTS applications.

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/language-TypeScript-3178C6.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![Platform](https://img.shields.io/badge/platform-HarmonyOS%20%2F%20ArkTS-0f172a.svg)](https://developer.huawei.com/consumer/cn/harmonyos)

ArkTaint 是一个面向 HarmonyOS / ArkTS 应用的静态污点分析系统。它的目标不是简单统计“疑似漏洞”，而是在 ArkTS 项目中恢复从 source 到 sink 的可解释污点流，并把框架入口、延后执行、项目 API、第三方 SDK 和路径证据统一到一条可审计的分析主线中。

> ArkTaint 输出的是静态污点流证据。污点流不自动等于漏洞；漏洞判断属于后续人工审计和报告层。

## 为什么需要 ArkTaint

HarmonyOS / ArkTS 应用的安全数据流通常不只发生在普通函数调用之间。真实项目里常见的复杂点包括：

- Ability、Extension、Component 生命周期和框架回调没有单一 `main()` 入口；
- AppStorage、LocalStorage、Router、Emitter、TaskPool 等框架机制会跨位置、跨回调交接数据；
- 项目会封装官方 API，也会引入陌生第三方 API，单靠方法名匹配很容易误判；
- source / sink / sanitizer / transfer / handoff 语义需要能复用、能审计、能逐步扩展；
- 后处理必须基于完整路径证据，不能凭一条局部规则静默删除真实流。

ArkTaint 因此把“API 是谁”和“API 做什么”拆开处理：身份由结构化 surface 证明，语义由声明式资产表达，传播由核心求解器消费，路径解释由证据系统和后处理完成。

## 架构总览

![ArkTaint 架构总览](assets/readme/system-architecture.png)

当前主线分为七个阶段：

1. **AssetRegistryBootstrap**：加载 `reviewed` / `replayed` / `official` 可信资产，建立身份、角色、endpoint、guard 和 cellKind 索引。
2. **PreAnalysis Evidence Pack**：观察项目里的调用、入口、装饰器和访问面，生成 `ObservedSurface`、`CoverageLedger` 与 LLM 证据包，不做传播。
3. **SemanticFlow LLM Modeling**：只处理 coverage gap，输出声明式候选资产，不输出传播代码，也不直接进入分析。
4. **Asset Promotion Gate**：通过 schema 校验、analyzer-backed surface、人工审计和复跑后，候选资产才能进入项目资产集。
5. **Full Analysis**：将 Rules、Modules、ArkMain、UDE 和 IR 操作实例化为 effect / StateEffect，由 OCLFS 和工作队列完成污点传播。
6. **Provenance**：保存不可变基础证据图，物化 `PathView`、`PathClass` 和 `PathGap`。
7. **Postsolve**：算法 F 只消费已物化路径证据，做路径级过滤、解释和 flow 聚合。

## 核心设计

### 统一资产身份层

ArkTaint 使用 Asset Surface Identity Layer 管理所有安全资产的覆盖面。

- `AssetSurface`：资产覆盖的程序面，例如 invoke、construct、access、entry、callback、decorator。
- `AssetIdentity`：由 surface 自动生成的稳定身份，用于 coverage query 和冲突检测。
- `AssetBinding`：说明某个 surface 的某个 endpoint / guard 承担 source、sink、transfer、handoff、entry 等角色。
- `AssetRelation`：表达有证据的 facade 关系，支持透明封装复用，但不把 facade 当作 runtime 传播事件。

已知覆盖判断只来自真实资产索引，必须按 `identity + role + endpoint + guard` 查询。ArkTaint 不使用方法名、owner 名、事件名等宽泛匹配来过滤 LLM 候选。

### 声明式语义资产

ArkTaint 的三类资产统一使用最新声明式结构：

- **Rules**：描述 source、sink、sanitizer、transfer 等局部安全语义。
- **Modules**：描述框架或 SDK 的 handoff、状态槽、容器、回调、异步等复杂语义。
- **ArkMain**：描述 HarmonyOS 托管入口、生命周期、组件和框架回调。

资产只声明 `surfaces`、`bindings`、`effectTemplates` 和 `relations`。运行时由 matcher 实例化为 `SemanticEffectInstance`，再交给稳定 consumer。LLM 与项目资产都不能生成求解器代码，也不能绕过 promotion gate。

### OCLFS：携带证明义务的局部流敏感分析

OCLFS 是 ArkTaint 当前主要求解改造方向，全称为 **Obligation-Carrying Local Flow Sensitivity**。

它把普通变量、字段、容器、框架存储槽、路由参数、事件通道等统一为 `StateCell`，把 source、copy、store、load、kill、link、sink 等统一为 `StateEffect`。对每个候选传播，OCLFS 生成 currentness obligations，判断 producer 写入的污点在 consumer 处是否仍然有效。

判断结果不是简单布尔值，而是：

- `live`：可以传播；
- `dead`：同一 cell 上的旧 epoch 被强证据失效；
- `may-live`：可能仍有效，保守保留；
- `unknown`：证据不足，保守保留或降置信；
- `blocked-mismatch`：可证明不是同一个状态单元。

OCLFS 只处理流敏感 currentness，不吸收路径敏感逻辑。路径条件、sanitizer 支配、参数化查询和多路径聚合交给算法 F。

### 证据图与后处理

ArkTaint 的路径系统分为三层：

- `BaseEvidenceGraph`：不可变基础证据图，只记录分析阶段已经发生的 derivation、blocked、currentness、model hit 和 sink hit。
- `PathMaterializer`：把基础证据物化为 `PathView`、`PathClass` 和 `PathGap`，并标记 complete、bounded-complete、truncated、incomplete 等状态。
- `PostsolveDecisionGraph`：算法 F 写入 `PathDecision` 和 `FlowDecision`，不回写基础证据。

因此，算法 F 不能恢复缺失路径，不能新增传播，不能重新求解 OCLFS currentness，也不能把单条路径证据扩大到整个 flow。

## 快速开始

### 环境要求

- Node.js 18+
- npm
- Windows / Linux / macOS 均可运行 TypeScript 层；真实 ArkTS 项目分析依赖本仓库准备的 ArkAnalyzer 子工程。

### 安装与构建

```bash
npm install
npm run build
```

`npm run build` 会先执行 `prepare:arkanalyzer`，确保 `arkanalyzer/` 子工程依赖可用。

### 运行完整门禁

```bash
npm run verify
```

`verify` 覆盖资产 schema、身份注册表、coverage ledger、SemanticFlow 输出、promotion gate、OCLFS、provenance、postsolve、分析 CLI 和架构卫生门禁。

### 真实项目 smoke

```bash
npm run test:smoke:core
npm run test:smoke:external
```

这两个命令使用固定的代表性真实项目 manifest。它们用于检查完整链路能否在真实项目上稳定运行，不代表漏洞发现能力评测。

## 基本用法

### 分析一个 ArkTS 项目

```bash
npm run analyze -- --repo D:/work/MyArkApp --sourceDir entry/src/main/ets --model-root src/models --outputDir tmp/test_runs/my_app/latest
```

常用参数：

- `--repo`：HarmonyOS 项目根目录；
- `--sourceDir`：ArkTS 源码目录，可用逗号传多个；
- `--model-root`：资产目录，通常为 `src/models`；
- `--profile`：分析档位，支持 `default`、`fast`、`strict`；
- `--maxEntries`：限制入口数量，便于调试；
- `--outputDir`：输出目录。

### 查看资产与模型

```bash
npm run analyze -- --repo D:/work/MyArkApp --list-models
npm run analyze -- --repo D:/work/MyArkApp --list-modules
npm run analyze -- --repo D:/work/MyArkApp --trace-module <module-id>
```

### 配置 LLM Profile

ArkTaint 使用 OpenAI-compatible HTTP API profile。API key 应放在环境变量或本机安全文件中，不要写入仓库、README、命令历史或测试产物。

```powershell
$env:ARKTAINT_LLM_API_KEY="your-api-key"
npm run llm -- --profile local-llm --baseUrl https://example.com/v1 --model your-model --apiKeyEnv ARKTAINT_LLM_API_KEY
npm run llm -- --show
```

`npm run llm -- --show` 会脱敏展示配置。

### 运行 SemanticFlow 建模

```bash
npm run analyze -- --autoModel --repo D:/work/MyArkApp --sourceDir entry/src/main/ets --model-root src/models --llmProfile local-llm --publish-model my_project_pack --outputDir tmp/test_runs/my_app_semanticflow/latest
```

工作流为：

```text
PreAnalysis
  -> CoverageLedger
  -> SemanticFlow evidence pack
  -> LLM candidate assets
  -> schema validation
  -> promotion gate
  -> full analysis
```

注意：`candidate`、`llm-generated`、`schema-valid` 资产不会参与 known-covered 过滤，也不会进入正式分析。只有通过审计与复跑提升为 `reviewed`、`replayed` 或 `official` 后，才会成为可信资产。

## 仓库结构

```text
src/
  cli/                    # analyze / llm / semanticflow CLI
  core/
    assets/               # schema v2、registry bootstrap、promotion gate、coverage ledger
    cellkind/             # 动态 cellKind registry
    orchestration/        # FullAnalysis、module lowering、postsolve、SemanticFlow runtime
    provenance/           # BaseEvidenceGraph、PathMaterializer、PathView / PathGap
    rules/                # rule asset lowering 与 runtime 接入
    semanticflow/         # LLM 建模证据包、输出、run record
  models/
    kernel/               # 内置 rules / modules / arkmain 资产
    project/              # 通过审计和复跑后的项目资产包
  tests/                  # schema、algorithm、pipeline、real-project smoke、门禁测试

assets/readme/            # README 图片资源
tests/manifests/          # 数据集、真实项目、benchmark manifest
tmp/                      # 本地运行产物，默认不提交
output/                   # 分析输出，默认不提交
```

## 资产开发原则

新增资产时必须遵守四条规则：

1. **身份和语义分离**：surface 只证明 API 是谁，binding/effect 才表达它做什么。
2. **动态注册，不靠名字表**：model 必须显式声明 `cellKind`，core 只校验和消费，不从 API 名猜测语义。
3. **候选不等于可信资产**：LLM 产物必须经过 schema 校验、人工审计和复跑提升。
4. **不保留旧格式**：正式资产不得使用旧字段或兼容入口，例如 `semantics.effects`、`semanticsRef`、`coverageSurfaces`、旧 `sources/sinks/transfers/sanitizers`、`ModuleRuntimeSpec`。

## 测试与门禁

常用测试：

```bash
npm run build
npm run verify
npm run test:architecture-hygiene-gate
npm run test:asset-schema-v2
npm run test:asset-registry-bootstrap
npm run test:cellkind-registry-dynamic
npm run test:algorithm-e-oclfs
npm run test:provenance-evidence-graph-boundary
npm run test:postsolve-scoped-evidence-contract
npm run test:smoke:core
```

门禁关注点：

- import boundary 不反向依赖；
- old asset fields 不进入正式资产；
- LLM candidate 不绕过 promotion；
- FullAnalysis 不出现双重传播入口；
- PathView 不被 postsolve 改写；
- incomplete / truncated path 不允许强过滤整个 flow；
- root 目录不放草稿、实验报告、临时输出或明文密钥。

## 输出与审计

ArkTaint 输出包括：

- source、sink、path、evidence 等结构化污点流记录；
- CoverageLedger 和资产缺口；
- SemanticFlow 建模候选、拒绝原因和 need-more-evidence；
- BaseEvidenceGraph、PathView、PathGap、PathDecision、FlowDecision；
- 适合人工审计的 Markdown / JSON 报告。

审计时应先确认 source、sink 和传播路径是否成立，再讨论是否构成漏洞。不要用 raw flow count 评价安全能力。

## 当前状态

当前主线已经完成：

- schema v2 资产结构；
- AssetRegistryBootstrap、CoverageLedger、PromotionGate；
- SemanticFlow evidence-pack 驱动建模；
- 动态 cellKind registry；
- InternalModuleLoweringIR 内部化；
- OCLFS currentness 证据；
- Provenance / Postsolve 边界；
- 真实项目 smoke manifest。

仍然需要持续推进的是安全资产质量：通过真实项目完整引擎运行加人工源码审计，发现可复用的 source、sink、sanitizer、transfer、handoff 和 entry 缺口，再用最小通用资产修复。

## 安全与密钥

- 不要提交 LLM API key、真实项目私有源码切片、token 或本地配置。
- `tmp/`、`output/`、`internal_docs/` 默认不进入公开提交。
- 公开 README 和测试 fixture 只使用占位 key 与脱敏路径。
- 如果发现误提交的密钥，应立即撤销密钥并清理历史。

## 许可证

本项目使用 [Apache License 2.0](LICENSE)。
