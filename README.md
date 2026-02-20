<div align="center">

# 🛡️ ArkTaint

**面向 HarmonyOS (ArkTS) 的开箱即用静态污点分析引擎**

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/language-TypeScript-3178C6.svg)](https://www.typescriptlang.org/)
[![HarmonyOS](https://img.shields.io/badge/platform-HarmonyOS-black)](https://developer.huawei.com/consumer/cn/harmonyos)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

[核心特性](#-核心特性) • [架构设计](#-架构概览) • [快速开始](#-快速开始) • [测试与基准](#-测试与基准) • [扩展开发](#-二次开发与插件)

</div>

---

## 📖 项目简介

**ArkTaint** 是一个专为 **HarmonyOS (ArkTS)** 原生应用生态设计的下一代静态污点分析（Static Taint Analysis）框架。

它构建在深度程序分析底座 [Arkanalyzer](https://gitcode.net/openharmony-sig/arkanalyzer) 生成的指针分配图（PAG）基础之上，旨在帮助安全研究人员和开发者自动发现隐私泄露、SQL 注入、命令注入等关键数据流安全问题。

**ArkTaint 的终极设计目标**：让“不懂底层代码的使用者”也能对陌生的 ArkTS 项目轻易执行污点分析。通过**零代码接入**与**单命令执行**设计，使用者只需提供项目路径与自定义规则配置（可选），即可一键输出清晰的漏洞识别报告，**全程无需修改引擎核心源码**。

## ✨ 核心特性

- **🚀 开箱即用 (Zero-Code Integration)**
  - **一键分析**：通过 CLI 单命令交互自动完成项目工程解析、入口探测、规则校验与流向追踪。
  - **自动规则分层机制**：支持规则配置的热插拔与优先级合并 (`default < framework < project < llm_candidate`)，即使在极低配置开销下，也有内置安全规则包安全兜底。
  - **高解释性报告**：引擎产出标准化的 `summary.md/json`，不仅展示污染链条的溯源数据，还能明确定位安全规则命中缘由以及规避提示。

- **🎯 极致精度的通用底座 (Precision & Capability)**
  - **自适应上下文敏感 (Adaptive k-CFA)**：支持按方法热点自动降维或升维的动态 context-sensitive 控制流分析（默认 k=1）。
  - **深度语言特性建模**：完整支持字段敏感（Field-Sensitive，涵盖嵌套对象和解构）、容器高精建模（Map/Set/List/Array的增删改查流转），和复杂的异步与事件流。
  - **边缘特性精准桥接**：自动修复因匿名箭头函数 `this` 丢失、`Reflect.call/apply` 反射调用，以及变长参数展开 (`...args`) 引起的控制图断裂。

- **🌟 独创鸿蒙专属引擎 (HarmonyOS Deep Modeling)**  *(开发中项)*
  - 针对 HarmonyOS 原生特性深度开发：将全面覆盖 `UIAbility` 的生命周期隐式流转 (`onCreate` 传递至视图 `build`)、跨组件高频数据总线 `AppStorage` 的显隐式穿透、以及 `@State`/`@Prop` 等装饰器驱动的高级多级传播图谱还原。

- **🤖 LLM 联合规则生成** *(规划中项)*
  - 接入大语言模型，通过静态解析结合目标源码，自动建议目标项目级 Source / Sink 种子配置以大幅消除未知域扫描盲区。

## 🏗️ 架构概览

ArkTaint 分析管线始终坚持“分析下沉与规则动态注入”的设计原则：

| 模块层级          | 核心职责与分工                                                                                                                 |
| :---------------- | :----------------------------------------------------------------------------------------------------------------------------- |
| **Phase 1: 底座** | `arkanalyzer`：提供前端基础编译与中间表示。负责生成 AST、构建系统调用图 (CallGraph) 并输出安全且不可变的局部指针分配表 (PAG)。 |
| **Phase 2: 引擎** | `src/core`：核心数据流工作流引擎主体。全量接管基于 Worklist 算法的污染跟踪，并管理所有的 Transfer 合流合并与条件计算。         |
| **规则与接口层**  | `src/cli` 与 `rules/`：统管应用扫描与报告收集。通过分离的数据配置使得第三方二次研发仅需拓展外部 JSON 即可生效全部特性。        |

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

# 2. 安装工程与分析底层依赖
npm install

# 3. 编译 ArkTaint TypeScript 源码
npm run build
```

### 🎯 一键分析目标项目

ArkTaint 最大的特色是可以直接对接你的测试项目进行零代码侵入分析：

```bash
# 方式 A：运行 ArkTaint 自带的快速演示靶场项目
# 演示将在 tmp/analyze/demo_complex_calls/summary.md 中生成分析报告
npm run analyze:demo

# 方式 B：针对您本地独立的真实工程进行污点全量探测
# <repo-path> 传入工程根目录路径即可
node out/cli/analyze.js --repo <repo-path>
```

分析完成后，您可以在同目录或 `--outputDir` 指定位置查看结果文件 `summary.md` 和 `summary.json` 以获取最终的漏洞统计与追溯链路。

## 📊 测试与基准 (Benchmark)

ArkTaint 具有顶尖的引擎稳定性指标和基线保障机制（以 2026-02-18 数据度量）：

| 验证维度               | 评估结果 (ArkTaint 对照情况) | 备注说明                                                        |
| :--------------------- | :--------------------------- | :-------------------------------------------------------------- |
| **全量数据集用例验证** | **100.0%** (230/230, k=1)    | 覆盖上下文敏感、字段敏感等绝大部分高级语言边界情况              |
| **端到端分析性能**     | **耗时显著下降结构优越**     | 全新设计的合并传输规则分发策略，耗时降低超过原有方案一半        |
| **准确率与对比表现**   | **FP=0, FN=0**               | 全量超越前期课题竞品（精度/性能/易用性/稳定性指标全面达标）     |
| **测试门禁与反老化**   | **无缝支持泛化拦截**         | 引入 Metamorphic 变型等价防过拟合验证机制及真实开源用例连续打点 |

### 自动化基线验证集测

若您试图二次开发核心逻辑，请执行以下命令检查有无出现性能或精测退化（建议作为所有 PR 提交前置项）：

```bash
npm run verify
```

## 🔌 插件扩展开发 (Seasoning System)

针对想要将分析引擎拓展分析不同前端框架，或补充独门分析黑科技的安全研究人员，我们在 `src/core/plugin` 支持名为 **Seasoning** 调味品的规范插件系统（*开发设计中*）：

- **只声明不操纵**：第三方开发者仅返回诊断贡献结果（如额外的 Source 种子、转移规则），引擎集中负责冲突判定与仲裁合并。
- **纯粹只读门面**：插件环境始终只暴露安全只读的 API Sandbox 对象门面 (`ReadonlyPluginContext`)。极大收敛错误代码触发的核心调度崩溃率。

## 📜 许可证

本项目基于 **Apache License 2.0** 开源协议发布。详细条款请参阅 [LICENSE](package.json) 文件相关标准约定声明。

## 📮 联系方式

使用过程中遇到的所有疑惑点及安全漏报 Bug，欢迎开 Issue 或与社区 Maintainer 沟通探讨。

---
<p align="center">Made with ❤️ for Security Automation and HarmonyOS Ecosystem.</p>
