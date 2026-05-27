---
id: "semanticflow/project-api-modeling"
title: "Project and Third-Party API Modeling"
---

# Project and Third-Party API Modeling

Use this skill when the slice describes a project API, third-party SDK API, or project wrapper around an official API.

## Boundary

Official/native semantics include HarmonyOS/OpenHarmony SDK, ArkUI, ArkTS, JavaScript/TypeScript built-ins, lifecycle, router, built-in storage, built-in callbacks, `hilog`, and `console`.

Project/third-party semantics include project `ApiClient`, `Http`, `Logger`, `TokenManager`, `CookieManager`, database wrappers, business SDKs, event buses, and third-party SDK wrappers.

Mixed semantics must be split. The official/native surface belongs to built-in assets. The project wrapper can be modeled only when it exposes a stable reusable API contract.

## General Rule

Model API semantics only. Do not decide final vulnerability status, do not reconstruct source-to-sink paths, and do not write solver logic.

Use declarative v2 assets:

- `surfaces` identify where the asset applies;
- `bindings` assign role, endpoint, guard, and referenced templates or relations;
- `effectTemplates` declare `rule.*`, `handoff.*`, or `entry.*` effects;
- `relations` describe transparent facade reuse only.

Surface shape is strict. For a method call or project wrapper method, output an `InvokeSurface`, not a generic API surface:

```json
{
  "surfaceId": "surface.Owner.method",
  "kind": "invoke",
  "modulePath": "relative/source/file.ets",
  "ownerName": "Owner",
  "methodName": "method",
  "invokeKind": "instance",
  "argCount": 2,
  "confidence": "likely",
  "provenance": {
    "source": "llm-proposal",
    "location": { "file": "relative/source/file.ets", "line": 12 }
  }
}
```

Never output `kind: "api"`, `file`, `owner`, `method`, or `line` directly on a surface. Use the registered surface fields above.

For a directly imported third-party function or ArkUI-style component call, use the import source as `modulePath`, the called symbol as `functionName`, and `invokeKind: "free-function"`. Do not use `invokeKind: "static"` unless there is a stable `ownerName`.

For option-object callbacks, use a callback locator with `kind: "option"`:

```json
{
  "base": {
    "kind": "callbackArg",
    "callback": {
      "kind": "option",
      "base": { "base": { "kind": "arg", "index": 0 } },
      "accessPath": ["onSendMessage"]
    },
    "argIndex": 1
  }
}
```

Bindings must use `effectTemplateRefs` or `relationRefs`. Never use `template`, `effectRef`, or `semanticsRef`.

Rule effect templates use `value`, `from`, and `to` for value positions. For `rule.sink` and `rule.sanitizer`, set `value` to the payload endpoint, or omit `value` only when the binding already has the exact same `endpoint`. Never put `endpoint` directly on a rule effect template.

A `rule.sink` endpoint must be consumed input such as receiver, argument, or callback argument. Do not model return values, promise results, constructor results, or callback returns as sinks. If a wrapper logs an internal local value or awaited result before returning it, do not turn the wrapper return into a sink; model the real log/storage/network call or return `need-more-evidence`.

For callback payload sources, the template must be shaped like this. `sourceKind` is a category, not the effect kind:

```json
{
  "id": "template.Chat.onSendMessage.arg1.source",
  "kind": "rule.source",
  "sourceKind": "callback_param",
  "value": {
    "base": {
      "kind": "callbackArg",
      "callback": {
        "kind": "option",
        "base": { "base": { "kind": "arg", "index": 0 } },
        "accessPath": ["onSendMessage"]
      },
      "argIndex": 1
    }
  },
  "confidence": "likely"
}
```

## Official API Calls

Do not create project assets for direct official/native APIs that are already covered by built-in assets. If the slice is a direct official surface and coverage is missing, return `need-more-evidence` or note an official/native semantic gap; do not invent a project asset.

If a project method merely calls official APIs internally, model the project method only when callers use it as a reusable wrapper. Ordinary lifecycle helpers, UI/window helpers, permission helpers, restoration helpers, routing dispatchers, and layout/style helpers are usually `reject` or `need-more-evidence`, not reusable security assets.

## Wrappers

For HTTP/request wrappers, model request payloads as `rule.sink` endpoints when caller-provided inputs are sent outward. If the wrapper also returns response data, model returned data separately as `rule.source` only when the current focused evidence asks for returned-value semantics.

For logging wrappers, model the message/payload endpoint that reaches `hilog`, `console`, or another log sink. Do not mark tag/category/context arguments as payload unless the code clearly uses that slot as the log message.

For database/storage/file wrappers, distinguish payload from selector/control metadata. Values buckets, record objects, file bodies, buffers, and serialized content are payloads. Table names, keys, URIs, predicates, picker options, flags, callbacks, and status booleans are not payloads unless the evidence shows executable or disclosed content.

For route/navigation wrappers, the page-stack operation itself is not a security sink. Route parameters can be semantic handoff carriers when later consumed by another surface.

## Semantic Handoff

Use `plane="module"` with `handoff.*` templates when a value is published through one surface and consumed by another:

- storage save/load/delete;
- route push/read;
- event emit/on;
- promise resolve/await-like wrappers;
- declarative state slot/link;
- callback maps or hidden receiver fields;
- project wrappers such as `TokenCache.save/load`.

Do not flatten hidden carriers into `rule.transfer`. The model declares `handoff.put/get/kill/link`; ArkTaint's handoff-sensitive solver consumes those effects.

Handoff handles must use the registered handle template shape:

```json
{
  "family": "storage",
  "key": [
    { "kind": "fromEndpoint", "endpoint": { "base": { "kind": "arg", "index": 0 } } }
  ],
  "owner": [
    { "kind": "const", "value": "PreferenceUtils.pref" }
  ],
  "precision": "infer"
}
```

Do not output `handle.kind`, `keyExpr`, `storeRef`, or arbitrary handle fields. `handoff.put` uses `value`; `handoff.get` uses `target`.

Omit optional handoff `scope` or `owner` when unknown. Never output empty arrays for optional handle fields.

If the matching consume/register surface is missing, return `need-more-evidence` with `kind="q_relation"` or `kind="q_effect"` instead of inventing a broad rule.

## Facade

Use `relations` only for transparent wrappers. A transparent facade must preserve relevant argument, return, and callback endpoints and must have code evidence. If the wrapper sanitizes, rewrites, conditionally drops, partially forwards, or asynchronously changes the payload, do not emit a facade relation.

## Callback and UI Component APIs

Project or third-party UI components may expose callback payloads through option-object callbacks such as `onChange`, `onPhoneChange`, or SDK listener callbacks. Model callback parameters as `rule.source` only when the payload is produced externally and delivered to project code. Use exact callback locators and access paths; do not model every callback parameter because the method name is `on`, `use`, or `subscribe`.

Callback registration or scheduling belongs to `entry.callbackRegister` or `entry.scheduleUnit`. Callback argument payload transfer belongs to `rule.*` or `handoff.*`, not to the entry effect itself.

## Need More Evidence

Return `need-more-evidence` when the wrapper body, companion surface, callback registration, key/route/channel extraction, final sink call, return payload source, or facade transparency is not visible. The `draft` must be a partial v2 asset draft, not an old summary object.
