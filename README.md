<div align="center">

# ArkTaint

**面向 HarmonyOS (ArkTS) 的静态污点分析引擎**

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/language-TypeScript-3178C6.svg)](https://www.typescriptlang.org/)
[![HarmonyOS](https://img.shields.io/badge/platform-HarmonyOS-black)](https://developer.huawei.com/consumer/cn/harmonyos)

[项目简介](#项目简介) · [核心特性](#核心特性) · [架构设计](#架构设计) · [快速开始](#快速开始) · [CLI 使用指南](#cli-使用指南) · [扩展开发](#扩展开发) · [规则配置](#规则配置) · [测试体系](#测试体系)

</div>

---

## 项目简介

**ArkTaint** 是面向 **HarmonyOS (ArkTS)** 生态的静态污点分析引擎，用于自动化检测隐私泄露、注入攻击等数据流安全问题。

它构建在程序分析底座 [ArkAnalyzer](https://gitcode.net/openharmony-sig/arkanalyzer) 之上，复用其指针分析图 (PAG) 与调用图 (CallGraph)，在此基础上实现上下文敏感的污点传播、检测与报告。

**设计目标**：使用者只需提供项目路径与规则配置（可选），即可获得漏洞识别报告，**无需修改引擎源码**。

## 核心特性

### 分析能力

- **自适应上下文敏感分析 (Adaptive k-CFA)** — 按方法热度动态调整上下文深度，平衡精度与性能
- **Worklist 污点传播引擎** — 基于 PAG 的精确数据流追踪，支持表达式级传播、字段敏感、容器语义
- **ArkMain 入口自动发现** — 不依赖 `main()` 函数，自动识别框架驱动的入口点（UIAbility 生命周期、Router 回调、Extension 等）
- **闭包与回调桥接** — 处理闭包捕获、回调注册 (`.on`/`.off`)、`Function.bind`、跨组件数据传递

### 鸿蒙深度建模

通过可插拔语义包 (Semantic Pack) 实现，支持以下 HarmonyOS 特性的污点传播建模：

| 特性 | 语义包 | 建模内容 |
|------|--------|---------|
| AppStorage / LocalStorage | `appstorage.pack` | 跨组件持久化存储的数据流传播 |
| Router 路由参数 | `router.pack` | `pushUrl` / `getParams` 跨页面参数传递 |
| UI 状态装饰器 | `state.pack` | `@State` / `@Prop` / `@Link` 父子组件数据绑定 |
| EventHub / Emitter | `emitter.pack` | `emit` → `on` 事件驱动数据流桥接 |
| Worker / TaskPool | `worker_taskpool.pack` | 跨线程数据传递 |
| Ability Handoff | `ability_handoff.pack` | `want` / `startAbility` 跨 Ability 数据流 |
| 容器语义 | `container.pack` | Map / Set / Array 容器操作的污点传播 |

### 工程化能力

- **规则分层机制** — `default` → `framework` → `project` 三级规则自动合并，优先级递增
- **引擎插件系统** — 6 阶段钩子 (`onStart` → `onEntry` → `onPropagation` → `onDetection` → `onResult` → `onFinish`)，支持观察、追加、替换三级能力
- **零代码接入** — 新项目分析不需要修改 `src/core/`，仅通过规则和配置驱动
- **解释性报告** — 输出 `summary.md` / `summary.json`，展示完整污点链路与规则命中明细

## 架构设计

ArkTaint 采用 **"三域"架构 (Core–Contract–Extension)**，将不可变的分析引擎、可插拔的扩展模块、用户交互接口彻底分离：

```
┌──────────────────────────────────────────────────────────────────┐
│                       引擎域 (src/core/)                         │
│                                                                  │
│   Assembler (orchestration/)   ── 驱动全流程，装配所有模块        │
│       │                                                          │
│   ┌───┴──────────────────────────────────────────────────┐       │
│   │  Substrate     Entry       Kernel        Rules       │       │
│   │  IR 查询    入口发现     传播引擎      规则引擎       │       │
│   └──────────────────────┬───────────────────────────────┘       │
│                          │                                       │
│               ┌──────────┴──────────┐                            │
│               │    契约边界          │                            │
│               │  kernel/contracts/  │                            │
│               └──┬──────┬───────┬──┘                            │
└──────────────────┼──────┼───────┼────────────────────────────────┘
                   │      │       │
    ┌──────────────┼──────┼───────┼──────────────────────┐
    │       扩展域  ▼      ▼       ▼                      │
    │   ┌────────┐ ┌──────┐ ┌──────────┐                 │
    │   │ 规则    │ │ 语义包│ │ 引擎插件  │                 │
    │   │src/rules│ │src/  │ │src/      │                 │
    │   │        │ │packs/│ │plugins/  │                 │
    │   └────────┘ └──────┘ └──────────┘                 │
    └────────────────────────────────────────────────────┘

    ┌────────────────────────────────────────────────────┐
    │       接口域                                        │
    │   src/cli/       命令行入口                         │
    │   docs/          用户文档                           │
    └────────────────────────────────────────────────────┘
```

### 引擎域（`src/core/`）

不可变的分析引擎内核，由 5 个功能模块组成：

| 模块 | 路径 | 职责 |
|------|------|------|
| **Substrate** | `core/substrate/` | 对 ArkAnalyzer IR 的查询封装（方法解析、回调识别、字符串追溯、SDK 来源判断） |
| **Entry** | `core/entry/` | ArkMain 入口自动发现模型（生命周期、回调、通道、调度器、桥接、可解释性） |
| **Kernel** | `core/kernel/` | WorklistSolver 污点传播 + 上下文敏感管理 + 契约接口定义 |
| **Rules** | `core/rules/` | Rule Schema v2.0 类型定义 + 多层规则加载合并 + 规则校验 |
| **Assembler** | `core/orchestration/` | 总装配器：驱动分析流程 + 语义包/引擎插件的加载与运行时调度 |

模块间依赖由自动化门禁 (`test_layer_dependency_gate`) 守卫。

### 契约边界（`kernel/contracts/`）

引擎域与扩展域之间的**唯一通道**。扩展域的所有代码只允许 import 契约接口，不允许触碰引擎域的实现文件。

### 扩展域

三类可插拔扩展，各自有严格的 import 隔离墙：

| 扩展类型 | 路径 | 允许 import | 用途 |
|---------|------|------------|------|
| **规则内容** | `src/rules/` | `core/rules/RuleSchema.ts` | 规则 JSON 文件 + 规则生成器 |
| **语义包** | `src/packs/` | `core/kernel/contracts/*` | 领域知识建模（数据流传播语义） |
| **引擎插件** | `src/plugins/` | `core/orchestration/plugins/EnginePlugin.ts` | 分析流程定制（修改引擎行为） |

### 项目目录结构

```
ArkTaint/
├── arkanalyzer/                    # 不可变底座（ArkAnalyzer）
├── src/
│   ├── core/                       # 引擎域
│   │   ├── substrate/queries/      #   IR 查询（4 文件）
│   │   ├── entry/                  #   入口发现（33 文件）
│   │   │   ├── arkmain/            #     ArkMain 模型
│   │   │   └── shared/             #     公用入口工具
│   │   ├── kernel/                 #   传播引擎（34 文件）
│   │   │   ├── context/            #     上下文敏感
│   │   │   └── contracts/          #     契约边界（15 文件）
│   │   ├── rules/                  #   规则引擎（3 文件）
│   │   └── orchestration/          #   装配器（8 文件）
│   │       ├── packs/              #     语义包加载器 + 运行时
│   │       └── plugins/            #     引擎插件加载器 + 运行时
│   ├── rules/                      # 扩展域：规则内容
│   │   ├── default.rules.json      #   内置默认规则
│   │   ├── framework.rules.json    #   框架级规则
│   │   └── templates/              #   项目规则模板
│   ├── packs/                      # 扩展域：语义包
│   │   ├── tsjs/                   #   TS/JS 通用（容器语义）
│   │   └── harmony/                #   HarmonyOS 特性建模（6 个语义包）
│   ├── plugins/                    # 扩展域：引擎插件
│   ├── cli/                        # 接口域：CLI
│   ├── tests/                      # 测试代码
│   └── tools/                      # 工具脚本
├── sdk/arkui/                      # 内置 ArkUI SDK 声明
├── tests/                          # 测试数据（67 个用例类别）
├── docs/                           # 用户文档
└── examples/                       # 语义包 / 引擎插件示例
```

## 快速开始

### 环境要求

| 依赖 | 版本要求 |
|------|---------|
| Node.js | `>= 18.15.0` |
| npm | `>= 9.0.0` |
| TypeScript | `>= 5.0.0` |
| 操作系统 | Windows / macOS / Linux |

### 安装与构建

```bash
git clone https://github.com/ArkTaint/ArkTaint.git
cd ArkTaint
npm install
npm run build
```

### 验证安装

```bash
npm run verify
```

## CLI 使用指南

### 基础用法

```bash
node out/cli/analyze.js --repo <项目路径>
```

### 参数说明

| 参数 | 必填 | 默认值 | 说明 |
|------|:----:|--------|------|
| `--repo <path>` | 是 | — | ArkTS 项目根目录路径 |
| `--sourceDir <path>` | 否 | 自动探测 | 源码目录（相对于 repo，逗号分隔多目录） |
| `--profile <mode>` | 否 | `default` | 分析预设：`fast`（快速）/ `default`（均衡）/ `strict`（高精度） |
| `--reportMode <mode>` | 否 | `light` | 报告详细度：`light`（关键链路）/ `full`（完整细节） |
| `--outputDir <path>` | 否 | `tmp/analyze/` | 报告输出目录 |
| `--framework <path>` | 否 | — | 额外的框架级规则 JSON 文件 |
| `--project <path>` | 否 | — | 项目特定规则 JSON 文件（最高优先级） |
| `--[no-]incremental` | 否 | 开启 | 启用/关闭解析增量缓存 |
| `--packs <path>` | 否 | — | 额外语义包目录 |
| `--plugins <path>` | 否 | — | 额外引擎插件目录或文件 |
| `--disable-builtin-packs` | 否 | — | 禁用内置语义包 |
| `--disable-plugins <name>` | 否 | — | 按名称禁用指定引擎插件 |

### 使用示例

**快速扫描**

```bash
node out/cli/analyze.js --repo ../my-harmony-app --profile fast
```

**高精度分析 + 自定义规则**

```bash
node out/cli/analyze.js --repo ../my-harmony-app \
  --sourceDir entry/src/main/ets \
  --profile strict \
  --project ./my_rules.json
```

**加载外部语义包和插件**

```bash
node out/cli/analyze.js --repo ../my-harmony-app \
  --packs ./my-packs \
  --plugins ./my-plugins/custom.ts
```

分析完成后，在 `outputDir` 下查看 `summary.md` 和 `summary.json` 获取漏洞报告。

## 扩展开发

ArkTaint 提供两种扩展机制，均为"放入即生效、删除即消失"的热插拔模式。

### 语义包（Semantic Pack）

用于添加领域知识——告诉引擎"数据在特定 API 中如何流动"。

```typescript
import { defineSemanticPack } from "../../core/kernel/contracts/SemanticPack";

export default defineSemanticPack({
    id: "my.custom.modeling",
    description: "自定义 API 的数据流建模",
    setup(ctx) {
        return {
            onInvoke(event) {
                if (event.methodName === "myTransfer") {
                    // 返回新的污点事实
                }
            },
        };
    },
});
```

将 `.pack.ts` 文件放入 `src/packs/` 或通过 `--packs` 指定外部目录。

### 引擎插件（Engine Plugin）

用于定制分析流程——修改引擎在各阶段的行为。

```typescript
import { defineEnginePlugin } from "../core/orchestration/plugins/EnginePlugin";

export default defineEnginePlugin({
    name: "my.custom.plugin",
    onStart(api) {
        // 动态添加规则
        api.addSourceRule({ /* ... */ });
    },
    onEntry(api) {
        // 添加自定义入口
        api.addEntry(myMethod);
    },
    onResult(api) {
        // 过滤误报
        api.filter(finding => isRelevant(finding) ? finding : null);
    },
});
```

将 `.ts` 文件放入 `src/plugins/` 或通过 `--plugins` 指定。

6 个阶段钩子提供三级能力：

| 能力级别 | 说明 | 示例 |
|---------|------|------|
| **观察** | 只读获取分析状态 | `getScene()`, `getFindings()`, `onCallEdge()` |
| **追加** | 向默认结果追加内容 | `addRule()`, `addEntry()`, `addFlow()`, `addFinding()` |
| **替换** | 接管整个阶段（可回退到默认实现） | `replace(fn, fallback)` |

> 详细开发指南参见 [`docs/engine_plugin_guide.md`](docs/engine_plugin_guide.md) 和 [`docs/semantic_pack_development_guide.md`](docs/semantic_pack_development_guide.md)。

## 规则配置

ArkTaint 使用 Rule Schema v2.0，支持四种规则类型。规则文件以 JSON 格式编写，通过分层机制自动合并。

### 污染源规则（Source）

```json
{
  "sources": [{
    "id": "source.harmony.want_uri",
    "sourceKind": "call_return",
    "match": { "kind": "method_name_equals", "value": "getWantUri" },
    "target": "result"
  }]
}
```

### 污染汇规则（Sink）

```json
{
  "sinks": [{
    "id": "sink.harmony.web_load",
    "match": { "kind": "method_name_equals", "value": "loadUrl" },
    "target": "arg0"
  }]
}
```

### 传播规则（Transfer）

```json
{
  "transfers": [{
    "id": "transfer.array.push",
    "match": { "kind": "method_name_equals", "value": "push" },
    "from": "arg0",
    "to": "base"
  }]
}
```

### 净化规则（Sanitizer）

```json
{
  "sanitizers": [{
    "id": "sanitizer.escape_html",
    "match": { "kind": "method_name_equals", "value": "escapeHtml" },
    "target": "result"
  }]
}
```

规则加载优先级：`default.rules.json` < `framework.rules.json` < `project.rules.json`

> 完整的规则 Schema 文档参见 [`docs/rule_schema.md`](docs/rule_schema.md)。

## 测试体系

### 门禁测试

| 命令 | 覆盖范围 |
|------|---------|
| `npm run verify` | 主链门禁：构建 + 层级依赖检查 + 语义包/插件运行时 + 入口模型 + CLI 集成 |
| `npm run verify:dev` | 扩展门禁：主链 + 真实项目烟测 + 项目规则工作流 |

### 专项测试

```bash
npm run test:context                # 上下文敏感测试
npm run test:full                   # 全量数据集测试
npm run test:harmony-bench          # HarmonyOS Benchmark
npm run test:entry-model            # ArkMain 入口模型测试
npm run test:layer-dependency-gate  # 架构层级依赖门禁
npm run verify:generalization       # 泛化验证
```

### 真实项目声明

为保持仓库纯净，**所有第三方项目源码不包含在本仓库内**。如需运行真实项目烟测：

1. 自行 Clone 目标项目到外部隔离目录
2. 修改 `tests/manifests/*_projects.json` 中的路径映射
3. 执行 `npm run test:smoke` 或 `npm run test:smoke:external`

## 许可证

本项目基于 [Apache License 2.0](LICENSE) 开源协议发布。

## 联系方式

使用中遇到的问题及安全漏报/误报，欢迎提交 Issue。
