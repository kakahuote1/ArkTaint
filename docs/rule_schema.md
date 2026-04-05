# ArkTaint Rules 编写说明

这份文档说明：

- `rules` 适合解决什么问题
- 当前规则目录如何组织
- `schemaVersion: "2.0"` 的主要字段
- 什么时候该写 `rule`，什么时候该写 `module` 或 `plugin`

## 1. 先分清 rule / module / plugin

### 写 rule

适合：

- 标一个 API return 是 source
- 标一个 API arg/base/result 是 sink
- 标一个 API 的 taint `from -> to` 传播
- 标一个 API/endpoint 是 sanitizer

也就是：

> 能用“匹配某个调用点 + 指定 endpoint 行为”表达的，优先写 rule。

### 写 module

适合：

- callback handoff
- 状态对象字段桥接
- router / handoff / emitter / worker 这类复杂硬编码语义
- rules 无法表达的多跳 continuation、复杂对象桥接

module 说明见 [Modules](./module_development_guide.md)。

### 写 plugin

适合：

- 改 entry discovery
- 改 propagation / detection / result 流程
- 观察或替换分析阶段本身

plugin 说明见 [Plugins](./engine_plugin_guide.md)。

## 2. 当前规则目录模型

规则根目录通常是 `src/rules`。

顶层先按 kind 分：

```text
src/rules/
  sources/
  sinks/
  sanitizers/
  transfers/
```

每个 kind 下再分：

- `kernel/`
  - 内建、默认启用
- `project/`
  - 可复用 project rule packs
  - 默认不启用

实际形态类似：

```text
src/rules/
  sources/
    kernel/
      callback.rules.json
      device.rules.json
    project/
      acme_sdk/
        uploader.rules.json

  sinks/
    kernel/
      logging.rules.json
      network.rules.json
    project/
      acme_sdk/
        upload_sink.rules.json
```

约束：

- 文件名要求 `*.rules.json`
- 一个文件只放一种 kind
- `project/<pack-id>/` 是可启用/禁用的 pack 单位

## 3. CLI 如何加载规则

最常见的是：

```bash
node out/cli/analyze.js \
  --repo <repo> \
  --ruleCatalog src/rules
```

这会自动加载：

- 所有 `kernel/**/*.rules.json`

如果要启用 project pack：

```bash
node out/cli/analyze.js \
  --repo <repo> \
  --ruleCatalog src/rules \
  --enable-rule-pack acme_sdk
```

常用参数：

- `--kernelRule <file>`
  - 额外 kernel 规则文件
- `--ruleCatalog <dir>`
  - 规则目录根
- `--rules <dir>`
  - `--ruleCatalog` 别名
- `--project <file>`
  - 一次性项目规则覆盖文件
- `--candidate <file>`
  - 候选规则文件
- `--enable-rule-pack <pack-id[,pack-id]>`
- `--disable-rule-pack <pack-id[,pack-id]>`

理解建议：

- 想长期复用：放进 `src/rules/**/project/<pack-id>/`
- 想快速试验：用 `--project` 或 `--candidate`

## 4. 顶层 JSON 结构

每个规则文件都必须是 `schemaVersion: "2.0"`：

```json
{
  "schemaVersion": "2.0",
  "meta": {
    "name": "acme-rules",
    "description": "Acme SDK rules"
  },
  "sources": [],
  "sinks": [],
  "sanitizers": [],
  "transfers": []
}
```

要求：

- 只能把本文件对应 kind 放非空
- 其他 kind 保持空数组

例如 `sources/*.rules.json`：

```json
{
  "schemaVersion": "2.0",
  "sources": [
    {
      "id": "source.acme.token",
      "sourceKind": "call_return",
      "match": {
        "kind": "method_name_equals",
        "value": "readToken"
      },
      "target": "result"
    }
  ],
  "sinks": [],
  "sanitizers": [],
  "transfers": []
}
```

## 5. 通用字段

所有 rule 共享这些字段：

- `id: string`
  - 唯一标识
- `enabled?: boolean`
  - `false` 时不进入运行时
- `description?: string`
- `tags?: string[]`
- `match: RuleMatch`
- `scope?: RuleScopeConstraint`
- `category?: string`
- `severity?: "low" | "medium" | "high" | "critical"`

### 5.1 `match`

当前常用 `match.kind`：

- `signature_contains`
- `signature_equals`
- `signature_regex`
- `declaring_class_equals`
- `method_name_equals`
- `method_name_regex`
- `local_name_regex`

通用形态：

```json
"match": {
  "kind": "method_name_equals",
  "value": "readToken"
}
```

还支持可选约束：

- `calleeClass`
- `invokeKind`
- `argCount`
- `typeHint`

例如：

```json
"match": {
  "kind": "method_name_equals",
  "value": "set",
  "invokeKind": "instance",
  "argCount": 2
}
```

### 5.2 `scope`

用于进一步限制文件、模块、类、方法范围：

```json
"scope": {
  "className": {
    "mode": "equals",
    "value": "EntryAbility"
  }
}
```

常用 key：

- `file`
- `module`
- `className`
- `methodName`

## 6. endpoint / path 模型

规则里的 source / sink / transfer 都围绕 endpoint：

- `base`
- `result`
- `matched_param`
- `arg0`
- `arg1`
- ...

简单写法：

```json
"target": "result"
```

需要 path 时，写 `RuleEndpointRef`：

```json
"target": {
  "endpoint": "arg0",
  "path": ["token"]
}
```

还可以写：

- `pathFrom`
- `slotKind`

这类主要用于容器/slot 相关 transfer。

## 7. SourceRule

核心字段：

- `sourceKind`
- `target`

当前常用 `sourceKind`：

- `seed_local_name`
- `entry_param`
- `call_return`
- `call_arg`
- `field_read`
- `callback_param`

### 7.1 return source

```json
{
  "id": "source.acme.read_token",
  "sourceKind": "call_return",
  "match": {
    "kind": "method_name_equals",
    "value": "readToken"
  },
  "target": "result"
}
```

### 7.2 callback source

```json
{
  "id": "source.acme.on_change",
  "sourceKind": "callback_param",
  "match": {
    "kind": "method_name_equals",
    "value": "onChange"
  },
  "target": "arg0",
  "callbackArgIndexes": [0]
}
```

### 7.3 entry param source

```json
{
  "id": "source.entry.want",
  "sourceKind": "entry_param",
  "match": {
    "kind": "method_name_equals",
    "value": "onCreate"
  },
  "target": {
    "endpoint": "arg0",
    "path": ["want"]
  }
}
```

entry source 还可以用：

- `paramNameIncludes`
- `paramTypeIncludes`
- `paramMatchMode`

## 8. SinkRule

sink 最核心的是：

- 匹配哪个调用
- taint 该落在哪个 endpoint

例如：

```json
{
  "id": "sink.acme.upload",
  "match": {
    "kind": "method_name_equals",
    "value": "upload"
  },
  "target": "arg0"
}
```

带字段路径：

```json
{
  "id": "sink.acme.send_saved",
  "match": {
    "kind": "method_name_equals",
    "value": "send"
  },
  "target": {
    "endpoint": "arg0",
    "path": ["saved"]
  }
}
```

## 9. SanitizerRule

sanitizer 结构和 sink 类似，也是围绕目标 endpoint：

```json
{
  "id": "sanitizer.acme.clean",
  "match": {
    "kind": "method_name_equals",
    "value": "sanitize"
  },
  "target": "result"
}
```

## 10. TransferRule

transfer 描述 `from -> to`：

```json
{
  "id": "transfer.acme.identity",
  "match": {
    "kind": "method_name_equals",
    "value": "identity"
  },
  "from": "arg0",
  "to": "result"
}
```

容器/slot 示例：

```json
{
  "id": "transfer.acme.map_put",
  "match": {
    "kind": "method_name_equals",
    "value": "put"
  },
  "from": {
    "endpoint": "arg1",
    "pathFrom": "arg0",
    "slotKind": "map"
  },
  "to": {
    "endpoint": "base",
    "pathFrom": "arg0",
    "slotKind": "map"
  }
}
```

## 11. 一般不要手写的治理字段

规则系统内部有三类治理字段：

- `layer`
- `family`
- `tier`

当前主线下，这三类通常由系统自动补齐和规范化。

因此：

- 一般不要在 authored JSON 里主动写它们
- 除非你明确知道自己在做高级治理控制

简单理解：

- `layer`
  - `kernel` 或 `project`
- `family`
  - 同类规则分组键
- `tier`
  - 同 family 下强弱优先级

## 12. 什么时候 rule 不够

遇到这些情况，优先考虑 module：

- callback 注册与回调参数 handoff
- 对象状态桥接
- continuation / later-load 语义
- 跨组件 handoff
- 复杂 router / state / storage 语义

因为这些往往已经超出：

> 匹配某个调用点 + endpoint from/to

这种规则模型的表达能力。

## 13. 推荐写法

### 推荐

- 先写最小规则
- 一个文件聚焦一种语义家族
- 复用 pack 时放到 `project/<pack-id>/`
- 用可读的 `id`
- 用 `description` 说明意图

### 不推荐

- 把复杂 handoff 强行塞进 transfer
- 在 authored JSON 里大量手写 `layer/family/tier`
- 一个文件混多种 kind
- 把一次性项目试验规则直接塞进 `kernel`

## 14. 验证与排错

最直接的 schema 验证：

```bash
npm run test:rules
```

规则目录治理与加载相关回归：

```bash
npm run test:rule-governance
npm run test:rule-loader-diagnostics
```

常见问题：

- 文件放错目录
  - 例如 `sources` 文件里写了 `transfers`
- `project` pack 没启用
  - 需要 `--enable-rule-pack`
- `match` 太弱
  - 命中面过宽，容易带来低 tier fallback
- endpoint/path 写反
  - 这是最常见的 authored 错误之一

## 15. 一份最小可复用 pack 模板

```text
src/rules/
  transfers/
    project/
      acme_sdk/
        upload.rules.json
```

```json
{
  "schemaVersion": "2.0",
  "meta": {
    "name": "acme-sdk-transfer"
  },
  "sources": [],
  "sinks": [],
  "sanitizers": [],
  "transfers": [
    {
      "id": "transfer.acme.upload",
      "description": "Acme uploader returns arg0 payload in result",
      "match": {
        "kind": "method_name_equals",
        "value": "upload"
      },
      "from": "arg0",
      "to": "result"
    }
  ]
}
```

启用：

```bash
node out/cli/analyze.js \
  --repo <repo> \
  --ruleCatalog src/rules \
  --enable-rule-pack acme_sdk
```
