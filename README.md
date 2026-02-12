
<div align="center">

# 🛡️ ArkTaint

**面向 HarmonyOS (ArkTS) 的静态污点分析引擎**

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/language-TypeScript-3178C6.svg)](https://www.typescriptlang.org/)
[![HarmonyOS](https://img.shields.io/badge/platform-HarmonyOS-black)](https://developer.huawei.com/consumer/cn/harmonyos)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

[特性](#-核心特性) • [架构](#-架构概览) • [快速开始](#-快速开始) • [文档](#-文档与资源) • [贡献](#-贡献指南)

</div>

---

## 📖 项目简介

**ArkTaint** 是一个专为 **HarmonyOS** 原生应用生态设计的静态污点分析（Static Taint Analysis）框架。

它构建在深度程序分析底座 [Arkanalyzer](./arkanalyzer) 之上，通过分析 ArkTS 源码生成的程序依赖图（PAG），精确追踪数据在应用内的流向。ArkTaint 旨在帮助开发者和安全研究人员自动发现隐私泄露、SQL 注入、命令注入等关键安全漏洞。

> ⚠️ **注意**：本项目目前处于活跃开发阶段（Alpha），API 和内部实现可能会随版本迭代发生变化。

## ✨ 核心特性

- **🎯 高精度分析**
  - **k-CFA 上下文敏感**：支持 k-limiting 上下文敏感分析，有效区分同一函数在不同调用点的行为（当前默认 k=1）。
  - **字段敏感（Field-Sensitive）**：深度追踪对象属性读写，支持嵌套对象与解构赋值。
  - **容器精确建模**：内置 Map、Set、List、Array 等标准容器的污点传播规则。

- **⚡ 现代语言支持**
  - **完整异步流**：精确模拟 `Promise` 链式调用（`.then`/`.catch`）与 `async`/`await` 语义。
  - **闭包与作用域**：正确处理闭包（Closure）内的变量捕获与跨作用域数据流。
  - **反射支持**：部分支持 `Reflect` API 的动态调用分析。

- **🧩 模块化设计**
  - **分析解耦**：底层 IR 生成（Arkanalyzer）与上层污点引擎完全解耦。
  - **插件化架构**：支持自定义 Source/Sink 定义与传播策略（Roadmap）。

## 🏗️ 架构概览

ArkTaint 采用典型的 **两阶段（Two-Phase）** 分析架构：

| 阶段        | 模块          | 职责                                                                                              |
| :---------- | :------------ | :------------------------------------------------------------------------------------------------ |
| **Phase 1** | `arkanalyzer` | **IR 生成**：解析 ArkTS 源码，构建 AST、CFG，最终生成指针分配图（PAG）与静态调用图（CallGraph）。 |
| **Phase 2** | `src/core`    | **污点分析**：在 PAG 之上运行基于 Worklist 的数据流分析算法，结合上下文管理器计算污点通路。       |

## 🚀 快速开始

### 前置要求

- **Node.js**: `^18.0.0`
- **npm**: `^9.0.0`
- **TypeScript**: `^5.0.0`

### 安装与构建

```bash
# 1. 克隆仓库
git clone https://github.com/YourOrg/ArkTaint.git
cd ArkTaint

# 2. 安装依赖
npm install

# 3. 编译项目
npm run build
```

### 运行验证

我们提供了一键式验证脚本，用于运行全量基准测试集：

```bash
# 运行完整验证流程（Build + Context Tests + Full Dataset）
npm run verify
```

如果看到类似以下的输出，说明环境配置正确：
```text
[PASS] k=1 coverage: 207/211 (98.1%)
All integration tests passed.
```

## 📊 性能基准

截至最新版本，ArkTaint 在我们的[内部基准数据集](tests/)上表现如下：

| 维度             | 指标      | 说明               |
| :--------------- | :-------- | :----------------- |
| **总体覆盖率**   | **98.1%** | 207/211 pass (k=1) |
| **上下文敏感度** | 100%      | 7/7 pass           |
| **字段敏感度**   | 100%      | 18/18 pass         |

*详细测试报告请参阅 [TASK.md](./task.md) 中的验证记录。*

## 🤝 贡献指南

我们非常欢迎社区贡献！如果您通过 ArkTaint 发现了新的 Bug，或者有改进建议：

1.  请先查阅 [Issue 列表](issues) 确保没有重复反馈。
2.  通过 Pull Request 提交修复或新特性，请确保通过 `npm run verify` 测试。
3.  对于重大变更，请先在 Issue 中讨论设计方案。

## 📜 许可证

本项目基于 **Apache License 2.0** 开源。详细条款请参阅 [LICENSE](./package.json) 文件。

```text
Copyright [2024-2026] [ArkTaint Contributors]

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```

## 📮 联系方式

如有任何问题，欢迎通过 GitHub Issues 进行交流。

---
<p align="center">Made with ❤️ for HarmonyOS Security</p>
