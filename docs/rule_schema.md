# ArkTaint Rules 编写说明

## 1. 先分清 rule / module / plugin

### 1.1 写 rule（推荐的默认选择）

适合：

- 标一个 API return 为 source
- 标一个 API arg/base/result 为 sink
- 标一个 API 的 taint `from -> to` 传播（transfer）
- 标一个 API/endpoint 为 sanitizer

一句话：

> 能用“匹配某个调用点 + 指定 endpoint 行为”表达的，优先写 rule。

### 1.2 写 module（当 rule 表达不够时）

适合：

- callback handoff（注册/绑定/回调参数传递）
- 状态对象字段桥接
- router / emitter / worker 这类复杂硬编码语义
- rules 很难表达的多步 continuation、复杂对象桥接

参见 [Modules](./module_development_guide.md)。

### 1.3 写 plugin（引擎级扩展）

适合：

- entry discovery（入口发现）
- propagation / detection / result 流程增强或替换
- 观察或替换分析阶段本身

参见 [Plugins](./engine_plugin_guide.md)。

## 2. 当前规则目录模型

规则根目录通常是 `src/models`。顶层先按 kind 分：

```text
src/models/
  sources/
  sinks/
  sanitizers/
  transfers/
```

每个 kind 下再分：

- `kernel/`：内建、默认启用
- `project/`：可复用的 project rule packs（默认不启用，需要 `--enable-model`）

示例：

```text
src/models/
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

- 文件名必须匹配 `*.rules.json`
- 一个文件只放一种 kind（不要把 sources/sinks/transfers 混在同一文件里）
- `project/<pack-id>/` 是可启用/禁用的 pack 单位

## 3. CLI 如何加载规则

最常见的是：

```bash
node out/cli/analyze.js \
  --repo <repo> \
  --model-root src/models
```

会自动加载：

- `kernel/**/*.rules.json`

启用 project pack：

```bash
node out/cli/analyze.js \
  --repo <repo> \
  --model-root src/models \
  --enable-model acme_sdk
```

常用参数（常见组合）：

- `--kernelRule <file>`：额外 kernel 规则文件
- `--model-root <dir>`：规则目录根（`--rules <dir>` 为别名）
- `--project <file>`：一次性项目规则覆盖文件
- `--candidate <file>`：候选规则文件
- `--enable-model <pack-id[,pack-id]>`
- `--disable-model <pack-id[,pack-id]>`

建议：

- 想长期复用：放进 `src/models/**/project/<pack-id>/`
- 想快速试验：用 `--project` 或 `--candidate`

## 4. 顶层 JSON 结构（schemaVersion 2.0）

每个规则文件都必须是 `schemaVersion: "2.0"`，并在顶层提供四类规则数组：

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

- 只允许把本文件对应的 kind 放非空（例如 sources 文件就只填 `sources`）
- 其他 kind 必须保持空数组

## 5. 通用字段（所有 rule 通用）

- `id: string`：唯一标识
- `enabled?: boolean`：`false` 时不进入运行时
- `description?: string`
- `tags?: string[]`
- `match: RuleMatch`
- `scope?: RuleScopeConstraint`
- `category?: string`
- `severity?: "low" | "medium" | "high" | "critical"`

### 5.1 `match`

常用的 `match.kind`：

- `signature_contains` / `signature_equals` / `signature_regex`
- `declaring_class_equals`
- `method_name_equals` / `method_name_regex`
- `local_name_regex`

通用形态：

```json
"match": {
  "kind": "method_name_equals",
  "value": "readToken"
}
```

常见可选约束：

- `calleeClass`
- `invokeKind`
- `argCount`
- `typeHint`

示例：

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
- `arg0` / `arg1` / ...

简单写法：

```json
"target": "result"
```

需要 path 时：

```json
"target": {
  "endpoint": "arg0",
  "path": ["token"]
}
```

## 7. 四类规则：source / sink / sanitizer / transfer

### 7.1 SourceRule（source）

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

### 7.2 SinkRule（sink）

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

### 7.3 SanitizerRule（sanitizer）

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

### 7.4 TransferRule（transfer）

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

## 8. 一般不要手写的治理字段

除非你明确在做治理/编排，否则一般不要在 authored JSON 里手写：

- `layer`
- `family`
- `tier`

## 9. 验证与排查

最直接的回归脚本：

```bash
npm run test:rules
npm run test:rule-governance
npm run test:rule-loader-diagnostics
```

