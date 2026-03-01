<div align="center">

# 🛡️ ArkTaint

**面向 HarmonyOS (ArkTS) 的静态污点分析引擎**

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/language-TypeScript-3178C6.svg)](https://www.typescriptlang.org/)
[![HarmonyOS](https://img.shields.io/badge/platform-HarmonyOS-black)](https://developer.huawei.com/consumer/cn/harmonyos)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

[核心特性](#-核心特性) • [架构设计](#-架构概览) • [规则配置范例](#-规则配置范例) • [CLI 使用指南](#-cli-使用指南) • [测试与真实项目](#-测试与真实项目-testing--real-world-projects)
</div>

---

## 📖 项目简介

**ArkTaint** 是针对 **HarmonyOS (ArkTS)** 生态设计的静态污点分析（Static Taint Analysis）工具。

它构建在程序分析底座 [Arkanalyzer](https://gitcode.net/openharmony-sig/arkanalyzer) 上，复用其指针分配图（PAG）基础，旨在帮助研究人员和开发者发现隐私泄露、SQL 注入等数据流安全问题。

**ArkTaint 的设计目标**：**低接入成本**与**面向应用层的规则配置**。使用者只需提供项目路径与自定义规则配置（可选），即可输出漏洞识别报告，无需修改引擎核心源码。

## ✨ 核心特性

- **🚀 开箱即用 (Zero-Code Integration)**
  - **一键分析**：通过 CLI 命令自动完成项目工程解析、入口探测、规则校验与流向追踪。
  - **规则分层机制**：支持规则配置的优先级合并 (`default < framework < project`)。
  - **解释性报告**：引擎产出 `summary.md/json`，展示污染链条和规则命中情况。

- **🎯 通用底座能力 (Capability)**
  - **自适应上下文敏感 (Adaptive k-CFA)**：支持按方法热点自动选择上下文深度（默认 k=1）。
  - **鸿蒙专属建模 (HarmonyOS Modeling)**：支持 AppStorage、LocalStorage、路由参数 (Router)、UI 状态装饰器 (@State/@Prop/@Link)、并发模型 (Worker/TaskPool/Emitter) 的数据流跟踪。
  - **语言特性桥接**：处理匿名箭头函数 `this` 丢失、`Reflect.call/apply` 反射调用及变长参数展开 (`...args`) 等场景。

## 🏗️ 架构概览

ArkTaint 分析管线遵循“分析下沉与规则动态注入”的设计原则：

| 模块层级          | 核心职责与分工                                                                                                   |
| :---------------- | :--------------------------------------------------------------------------------------------------------------- |
| **Phase 1: 底座** | `arkanalyzer`：提供前端基础编译与中间表示。负责生成 AST、构建系统调用图 (CallGraph) 并输出局部指针分配表 (PAG)。 |
| **Phase 2: 引擎** | `src/core`：核心数据流工作流引擎主体。基于 Worklist 算法跟踪污染，并管理 Transfer 条件计算。                     |
| **规则与接口层**  | `src/cli` 与 `rules/`：统管应用扫描与报告收集。通过分级的数据配置（framework/project等）指导分析。               |

## 🚀 快速开始

### 🛠️ 前置要求

- **Node.js**: `^18.15.0`
- **npm**: `^9.0.0`
- **TypeScript**: `^5.0.0`
- **系统环境**: 跨平台兼容 (Windows / macOS / Linux)

### 📦 安装与构建

```bash
# 1. 克隆仓库
git clone https://github.com/YourOrg/ArkTaint.git
cd ArkTaint

# 2. 安装相关依赖
npm install

# 3. 编译 ArkTaint TypeScript 源码
npm run build
```

## 💻 CLI 使用指南

ArkTaint 提供了灵活的命令行工具进行项目分析：

```bash
# 基础用法：针对本地工程进行污点探测
node out/cli/analyze.js --repo <repo-path>
```

### 核心参数详解

| 参数名                | 必填  | 默认值         | 说明                                                                                                                                                                       |
| :-------------------- | :---: | :------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--repo <path>`       |   ✅   | -              | 指定要分析的 ArkTS 项目根目录绝对或相对路径。                                                                                                                              |
| `--sourceDir <path>`  |   ❌   | 自动探测       | 指定源码目录（相对于 repo 根目录，支持逗号分隔）。默认探测 `entry/src/main/ets` 等。                                                                                       |
| `--profile <mode>`    |   ❌   | `default`      | 分析配置预设：<br>`default`: k=1, 并发 4, 最大入口 12。<br>`strict`: 最高精度, 最慢。k=1, 并发 2, 最大入口 20。<br>`fast`: 快速扫描, 误报多。k=0, 并发 6, 最大入口 8。<br> |
| `--reportMode <mode>` |   ❌   | `light`        | 报告详细程度。`light` (仅关键链路) 或 `full` (完整图谱跟踪细节)。                                                                                                          |
| `--outputDir <path>`  |   ❌   | `tmp/analyze/` | 输出分析报告的存放目录，默认以时间戳命名。                                                                                                                                 |

### 规则与策略调优参数

| 参数名                   | 说明                                                                               |
| :----------------------- | :--------------------------------------------------------------------------------- |
| `--framework <path>`     | 指定额外的框架级规则 JSON 文件路径。                                               |
| `--project <path>`       | 指定项目特异性规则 JSON 文件路径（优先级高于 framework，常用）。                   |
| `--entryHint <keywords>` | 入口探测关键字，提示分析器优先扫哪些函数（逗号分隔，如 `onClick,aboutToAppear`）。 |
| `--include`/`--exclude`  | 按文件路径过滤分析范围（支持逗号分隔指定多个规则）。                               |
| `--[no-]incremental`     | 启用/关闭解析增量缓存（默认自动开启以节约二次扫描时间）。                          |

### 🚀 执行示例

**示例 1：低配置全量快速扫描**
适合第一次接触项目，想快速看看有没有明显流向：
```bash
node out/cli/analyze.js --repo ../target-project --profile fast
```

**示例 2：高精度针对性排查**
适合深度分析特定组件（如包含关键词 `Login` 的文件），叠加自定义业务白名单规则，并指定关注 `onClick` 入口点：
```bash
node out/cli/analyze.js --repo ../target-project \
  --profile strict \
  --project ./my_custom_rules.json \
  --include Login \
  --entryHint onClick
```

分析完成后，可以在对应的 `outputDir` 下查看结果文件 `summary.md` 和 `summary.json` 以获取最终的漏洞统计与追溯链路。

## 💡 规则配置范例

ArkTaint 的分析行为高度配置化，支持各类规则：

### 1. 传播规则 (Transfer Rules)

精准控制污点在特定函数调用内的走向：

```json
{
  "transfers": [
    {
      "id": "transfer.example.push_to_array",
      "match": { "kind": "method_name_equals", "value": "push" },
      "from": "arg0",
      "to": "base"
    }
  ]
}
```

### 2. 净化守卫规则 (Sanitizer Guard Rules)

消除已知安全过滤函数引起的误报：

```json
{
  "sanitizers": [
    {
      "id": "sanitizer.example.escape_html",
      "sanitizeTarget": "result",
      "sanitizeTargetRef": { "endpoint": "result" },
      "match": { "kind": "method_name_equals", "value": "EscapeHTML" }
    }
  ]
}
```

## 📊 测试与真实项目 (Testing & Real-world Projects)

ArkTaint 包含全量上下文敏感测试集及变形测试集 (`metamorphic`) 来验证引擎稳定性。

| 验证维度               | 评估结果                  | 备注说明                                    |
| :--------------------- | :------------------------ | :------------------------------------------ |
| **全量数据集用例验证** | **100.0%** (230/230, k=1) | 涵盖完整的语法测试用例与高级语言边界        |
| **泛化性与防过拟合**   | **自动化门禁**            | 引入 `Metamorphic` 变型等价防过拟合验证机制 |

### ✅ 主仓库自动化门禁

每次提交前，可运行基线验证集：

```bash
# 执行完整的开发者数据、holdout 用例和变形等价测试
npm run verify:generalization
```

### ⚠️ 真实项目与烟雾测试声明 (重要)

为了保持主仓库代码的纯净，并遵循严格的仓库隔离纪律，**所有第三方的真实大型开源项目（如 `WanAndroidHarmoney`、`HarmonyStudy` 等）的源码均不包含在本项目内。**

因此：
1. 本仓库内的代码仅包含 ArkTaint 引擎、SDK 规则和各种 mock/demo 小用例。
2. 相关的“真实项目烟测（Smoke Tests）”脚本（例如 `npm run test:smoke:external`）所依赖的项目路径通常配置在一个外部目录（如 `D:\cursor\workplace\project\` 或你自己的工作区）。
3. 如果你需要运行真实项目分析并验证本文档或论文中的数据，请**自行 Clone 对应的开源项目**到本地的隔离目录，并调整相应的 `tests/manifests/*_projects.json` 清单里的路径映射，才能正常启动测试。

## 📜 许可证

本项目基于 **Apache License 2.0** 开源协议发布。详细条款请参阅 LICENSE 文件。

## 📮 联系方式

使用过程中遇到的疑惑点及安全漏报/误报，欢迎提交 Issue。
