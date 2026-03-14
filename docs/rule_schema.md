# ArkTaint 规则 Schema（Phase 4.7 M0）

## 1. 目标
- 提供可加载、可校验、可回滚的规则底座。
- M0 仅做 `schema + loader + default rules`，不迁移核心传播实现。

## 2. 顶层结构

```json
{
  "schemaVersion": "1.0",
  "meta": {
    "name": "arktaint-default-rules",
    "description": "M0 default source/sink/transfer rules",
    "updatedAt": "2026-02-14"
  },
  "sources": [],
  "sinks": [],
  "transfers": []
}
```

## 3. 通用字段

每条规则公共字段：
- `id: string` 唯一标识（同类别内唯一）
- `enabled?: boolean` 默认为启用
- `description?: string`
- `tags?: string[]`
- `match: { kind, value }`

`match.kind` 可选：
- `signature_contains`
- `signature_regex`
- `method_name_equals`
- `method_name_regex`
- `local_name_regex`

## 4. Source 规则

附加字段：
- `profile?: "seed_local_name" | "entry_param"`
- `target?: "base" | "result" | "argN"`

用途：
- 默认用于入口种子命名/参数策略归档与后续扩展。

## 5. Sink 规则

附加字段：
- `profile?: "keyword" | "signature"`
- `severity?: "low" | "medium" | "high"`

用途：
- 为烟测与后续插件化 sink 识别提供统一配置来源。

## 6. Transfer 规则

附加字段：
- `from: "base" | "result" | "argN"`
- `to: "base" | "result" | "argN"`

M0 先覆盖常见调用点语义（Map/List/Array/Promise/Reflect）。

## 7. 校验规则

校验脚本会检查：
- 顶层字段完整性与类型
- `match.kind/value` 合法性
- 正则语法合法性
- `from/to/target` 是否为 `base/result/argN`
- 规则 `id` 重复

命令：
```bash
npm run test:rules
```

## 8. 文件与加载

- 默认规则包：`rules/default.rules.json`
- Loader：`src/core/rules/RuleLoader.ts`
- Validator：`src/core/rules/RuleValidator.ts`

支持：
- `default + override` 合并（按同 `id` 覆盖）
- 可选 override 缺失容忍（用于项目级规则）
