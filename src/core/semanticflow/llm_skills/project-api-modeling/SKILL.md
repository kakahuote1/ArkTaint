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
- `effectTemplates` declare `rule.*`, `handoff.*`, registered `module.*`, or `entry.*` effects;
- `relations` describe transparent facade reuse only.

Plane and effect families must match. A `rule` asset may contain only `rule.*` templates. A `module` asset may contain only `handoff.*` templates or registered `module.*` templates such as `module.eventEmitter`. An `arkmain` asset may contain only `entry.*` templates. Do not put `rule.*` templates in a `module` asset, and do not put `handoff.*` or `module.*` templates in a `rule` asset.

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

Every `rule.sink` effect template must include a non-empty `sinkKind` string. Use a stable boundary family such as `third_party_sdk_boundary`, `network_request`, `storage_write`, `logging`, `database_write`, `file_write`, or `ipc_send`. Do not omit `sinkKind`, even when the binding endpoint already identifies the payload.

A `rule.sink` endpoint must be consumed input such as receiver, argument, or callback argument. Do not model return values, promise results, constructor results, or callback returns as sinks. If a wrapper logs an internal local value or awaited result before returning it, do not turn the wrapper return into a sink; model the real log/storage/network call or return `need-more-evidence`.

For `rule.source`, distinguish immediate return from Promise fulfillment. Use:

```json
{ "base": { "kind": "promiseResult" } }
```

when an async or Promise-returning wrapper returns external data that callers consume through `await` or `.then(...)`. Use `{ "base": { "kind": "return" } }` only when the immediate returned object itself is the source value.

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

## Third-Party and Project SDK Boundaries

Third-party and project API surfaces must be generated as project-scoped assets from the evidence slice. Do not assume a third-party SDK method is covered by built-in assets, and do not ask for a default kernel rule for project-specific names.

When the slice shows a stable SDK boundary such as chat login, message send, push, analytics, payment, maps, media upload, or business service calls, model only the observed anchored surface and endpoint:

- caller-controlled account identifiers, tokens, passwords, message bodies, attachments, request payloads, and profile fields can be `rule.sink` endpoints when the code shows they leave the app through the SDK boundary;
- externally delivered SDK callback payloads can be `rule.source` endpoints;
- SDK session/cache/store pairs are `module` assets with explicit `cellKind` only when the publish and consume/delete surfaces are visible;
- same-name local classes, demo stubs, helpers, mocks, and unrelated owners are negative evidence unless the analyzer anchor shows they are the actual SDK/project surface.

Some SDK boundaries appear directly inside page/component/view code rather than in a separate service file. When the slice is marked `candidateOrigin=recall_direct_boundary_surface` or `candidateBoundary=direct_project_or_third_party_callsite_evidence`, treat it as a callsite-anchored project/third-party API modeling question. Use the exact `methodSignature`, typed receiver owner, `importSource`, `callerFile`, and visible option-object payload mapping from the slice. Do not reject it only because the file is under `pages`, `components`, or `views`. Do not model a same-name local helper unless the slice has analyzer-backed receiver/import evidence for that exact helper.

For pub/sub, messaging, MQTT, push, event bus, queue, room, channel, and postMessage-style APIs, distinguish routing selectors from payload. `topic`, `channel`, `queue`, `room`, `conversation`, `target`, `eventName`, and similar identifiers are selector/control metadata by default. They are not `rule.sink` payload endpoints unless the evidence shows that the identifier value itself is disclosed user content. Prefer `payload`, `message`, `body`, `content`, `data`, `attachment`, `file`, or serialized object fields as sink endpoints when they are visibly sent through the boundary.

For WebView, JSBridge, hybrid-container, native-bridge, or message-proxy receiver methods, prioritize the external message argument over incidental receiver fields. When the method body forwards a parameter object into a bridge dispatcher, for example `messageHandler(...)`, `messageHandlerNext(...)`, `callHandler(...)`, `serviceToContainer(...)`, `postMessage(...)`, `DMPMap.createFromObject(msg.body)`, `msg.type`, `msg.target`, `payload.body`, or similar payload extraction, the modeled semantics must describe the delivered bridge payload, not helper receiver state used for lookup or routing.

- `msg`, `payload`, `message`, `params`, `data`, and their fields such as `body`, `content`, `type`, `target`, `method`, `args`, or `callbackId` are bridge-delivered data or selector metadata depending on use.
- `body`, `content`, `data`, serialized objects, and callback arguments are payload candidates.
- `type`, `target`, method names, app indexes, page ids, webview ids, and routing identifiers are selector/control metadata unless the evidence shows they are disclosed as user content.
- Receiver fields such as `this.appIndex`, `this.webViewId`, `this.controller`, `this.page`, or `this.app` are context carriers for dispatch lookup by default. Do not model them as the main asset for a bridge receiver method when the focused surface is the receiver method and the snippet shows an external message argument being forwarded.
- If the evidence only shows a receiver field lookup and does not show how the incoming message payload reaches another surface, return `need-more-evidence` with a payload/companion evidence request. Do not emit an object-field handoff for the incidental receiver field as a substitute for the missing bridge payload model.
- If both receiver-field carrier snippets and bridge payload snippets are present, model the bridge payload first. A separate receiver-field handoff is allowed only when the current focused flow explicitly concerns that receiver field and the write/read companion is visible.

Always use exact `InvokeSurface` identity from the analyzer-backed evidence: `modulePath`, `ownerName` or `functionName`, `methodName`, `invokeKind`, and `argCount`. When the prompt includes `methodSignature`, treat it as the resolved callsite identity. For receiver method calls, derive `ownerName` and `methodName` from that `methodSignature`. If the callsite is statically resolved to a base class or interface method but the snippets mention a concrete implementation subclass, keep `ownerName` equal to the declaring owner in `methodSignature`; the implementation class is evidence for semantics, not the surface identity. For ownerless function/component signatures shaped like `@%unk/%unk: .ComponentName(...)` or `@entry/.../File.ets: functionName(...)`, use `invokeKind="free-function"`, `functionName="ComponentName"` / `functionName="functionName"`, and no `ownerName` or `methodName`; do not invent a static owner from the source file, file basename, import module, or wrapper variable. Do not output a sibling static surface for the same ownerless function, and do not bind a source/sink role to a static sibling when the analyzer-backed callsite is ownerless/free-function. Do not model `ChatClient`, `sendMessage`, `login`, `on`, `emit`, or `send` by name alone.

For ownerless free-function/component callback sources, keep `modulePath` as the imported component or function module, but set `surface.provenance.location.file` to the registration callsite file shown by `callerFile` in the evidence slice. This callsite file is where the callback source rule is matched. Do not use the component definition file as `provenance.location.file` unless the same file is also the `callerFile`.

If the slice contains a likely third-party SDK call but the wrapper body, import, owner, endpoint, or payload mapping is missing, return `need-more-evidence` instead of broadening the selector.

## Official API Calls

Do not create project assets for direct official/native APIs that are already covered by built-in assets. If the slice is a direct official surface and coverage is missing, return `need-more-evidence` or note an official/native semantic gap; do not invent a project asset.

If a project method merely calls official APIs internally, model the project method only when callers use it as a reusable wrapper. Ordinary lifecycle helpers, UI/window helpers, permission helpers, restoration helpers, routing dispatchers, and layout/style helpers are usually `reject` or `need-more-evidence`, not reusable security assets.

## Wrappers

For HTTP/request wrappers, model request payloads as `rule.sink` endpoints when caller-provided inputs are sent outward. If the wrapper also returns response data, model returned data separately as `rule.source` only when the current focused evidence asks for returned-value semantics.

Visible HTTP/request wrappers are normally `plane="rule"` when the current slice asks for request sinks, response sources, sanitizers, or visible same-call transfer. Use `plane="module"` only when the important behavior is a hidden carrier such as publish/consume/kill/link across multiple surfaces.

Receiver-field carrier evidence appears as `carrierRoots` such as `this.requestHeaders`, `receiverCarrierOwner`, `carrierTouch`, `carrierCompanion`, `carrier-context`, and `carrier-sibling-*` snippets. This evidence means methods on the same receiver share hidden object state.

If a wrapper sends, logs, or stores a value read from `this.<field>` inside the current surface, model the consumed receiver field precisely:

- same-surface consumption can be a `rule.sink` on endpoint `receiver` with an `accessPath` for the consumed field only for the final boundary;
- cross-method write/read must be a `plane="module"` handoff with `cellKind="object-field"`;
- use a stable project/API `family`, and put the receiver field path in the handoff handle key;
- for `handoff.put`, choose the value endpoint that actually carries taint. If a builder method derives `this.requestHeaders` from `this.options.secret`, use `value: { "base": { "kind": "receiver" }, "accessPath": ["options", "secret"] }`; do not default to `value: { "base": { "kind": "return" } }` unless the returned value itself is the evidenced tainted value;
- when multiple receiver fields visibly contribute to the same hidden carrier, emit separate `handoff.put` templates for those contributing access paths and use `updateStrength: "weak"` so one component does not erase another;
- do not model receiver field reads such as `this.options.secret`, `this.requestHeaders`, or `this.client.token` as standalone `rule.source` merely because the field is read.

When `carrierRoots`, `carrier-sibling-*`, or `carrierCompanion` snippets are present, an asset that only marks formal parameters as `rule.sink` is incomplete for the receiver-field carrier. Do not replace `this.requestHeaders`, `this.options.secret`, or another hidden receiver field with broad `arg0`, `arg1`, or all-argument sinks. If the current surface is the final disclosure boundary, include a precise receiver endpoint such as `{ "base": { "kind": "receiver" }, "accessPath": ["requestHeaders"] }` for the consumed field. If the write/read relation crosses sibling methods, emit a `plane="module"` object-field handoff companion with `cellKind="object-field"` when the companion is visible; otherwise return `need-more-evidence` for the companion handoff instead of widening arguments or emitting a rule-only asset.

Project storage and persistent-state wrappers are not receiver-field carriers merely because their evidence slice contains `this.getPreferences`, `this.preferences`, `this.itemBuilder`, or another receiver/framework helper around the storage call. Model the wrapper's key/value behavior with `plane="module"` and `cellKind="persistent-storage-slot"`. Use `cellKind="object-field"` only when the focused flow is actually stored in that receiver field.

Use `rule.source` for external API outputs, callback payloads, user input wrappers, or framework-delivered data. Hidden receiver state is a carrier; use handoff or return `need-more-evidence` when the write/read relation is not clear.

Object-field handoff schema is still ordinary v2 module schema:

- every binding uses `role: "handoff"`; never use `role: "put"` or `role: "get"`;
- direction is expressed only by `effectTemplates[].kind`, such as `handoff.put` or `handoff.get`;
- the handle is `{ "cellKind": "object-field", "family": "project.<namespace>", "key": [{ "kind": "const", "value": "<fieldPath>" }], "precision": "exact" }`;
- `handoff.put` uses a `value` AssetEndpoint, for example `{ "base": { "kind": "return" } }`, `{ "base": { "kind": "arg", "index": 0 } }`, or `{ "base": { "kind": "receiver" }, "accessPath": ["config", "password"] }`;
- `handoff.get` uses a `target` AssetEndpoint, for example `{ "base": { "kind": "receiver" }, "accessPath": ["requestHeaders"] }`;
- do not use `handle.kind`, `keyExpr`, `storeRef`, string-valued `value`, string-valued `target`, or arbitrary role names.

Construct surfaces have constructor-call semantics. A construct surface has no receiver input. If the hidden carrier is derived from constructor parameters such as `new ApiClient(config)`, model the source with an argument endpoint such as `{ "base": { "kind": "arg", "index": 0 }, "accessPath": ["secret"] }` or `["account"]`. Use `{ "base": { "kind": "constructorResult" }, "accessPath": ["field"] }` only when the evidence names a field on the constructed object itself. Do not use `{ "base": { "kind": "receiver" } }` on construct-surface bindings or `handoff.put` templates.

### Request Payload Endpoint Coverage

When a wrapper builds a request payload object from visible formal parameters, emit one endpoint-specific `rule.sink` binding and one matching `rule.sink` effect template for every formal parameter that visibly enters the outgoing payload.

When observations contain structured formal-parameter evidence such as `formalParam=argN;name=...;semanticRole=...` or `requestWrapperEndpointHint=...`, use those roles to choose endpoints. `control-metadata` and `destination-metadata` slots such as request method, mode, flags, route, path, URL, host, or endpoint are not payload sinks by default. `payload` and `header-or-credential-payload` slots are normal request sink candidates when the code shows they reach the outgoing request, log, file, database, or SDK boundary.

Example:

```ts
export const loginApi = (phone: string, code: string) => {
  const params = { phone, code };
  return http.post('/login', params);
}
```

This wrapper has two payload endpoints:

- `arg0` because `phone` is assigned into `params.phone`;
- `arg1` because `code` is assigned into `params.code`.

The asset must therefore contain separate sink bindings/templates for `arg0` and `arg1`. Do not collapse both fields into only `arg0`, and do not use a single broad receiver/object endpoint when the consumed caller positions are visible.

The same rule applies to typed object payloads, shorthand object literals, query parameter objects, header/body objects, and wrapper calls such as `http.post(url, params)`, `http.get(url, params)`, `request({ data: params })`, or `request({ params })`, when the field-to-formal-parameter mapping is visible in the slice.

Do not mark every argument as a sink by default. URL/path/control arguments, flags, callbacks, request methods, retry options, and static constants are sinks only when the code shows that their value is sent as payload or disclosed content. If the payload object is visible but the formal-parameter-to-field mapping is missing or ambiguous, return `need-more-evidence` with `kind="q_endpoint"` instead of guessing.

For request constructors such as `new Request(url, method, headers, body)`, treat `method`, path, URL, and routing arguments as control or destination metadata by default. Model them as `network_request` sinks only when the evidence explicitly asks for destination/SSRF-style semantics or shows that their value is disclosed as content. Body, payload, headers, files, buffers, and serialized objects are the normal request sink endpoints.

For logging wrappers, model the message/payload endpoint that reaches `hilog`, `console`, or another log sink. Do not mark tag/category/context arguments as payload unless the code clearly uses that slot as the log message.

For database/storage/file wrappers, distinguish payload from selector/control metadata. Values buckets, record objects, file bodies, buffers, and serialized content are payloads. Table names, keys, URIs, predicates, picker options, flags, callbacks, and status booleans are not payloads unless the evidence shows executable or disclosed content.

For project key-value or persistent-state wrappers, do not classify a save/set/put method as `rule.sink` when the evidence shows a companion load/get/delete method over the same handle. Model the wrapper family as `plane="module"`:

- save/set/put/write/store/insert/update -> `handoff.put` with `value` at the stored payload endpoint;
- load/get/read/query/fetch -> `handoff.get` with `target` at the return or promise result endpoint;
- delete/remove/clear -> `handoff.kill`.

Use `cellKind="persistent-storage-slot"` for wrappers around Harmony preferences, files, databases, KV stores, DataShare, or other durable project storage. Use `cellKind="keyed-semantic-slot"` for in-memory cache/session/token managers. The storage key, namespace, table, or preference name belongs in the `handle.key`, `scope`, or `owner`; it is selector metadata, not a sink payload by default.

Paired handoff surfaces must use the same handle layout. If save/load/delete methods belong to the same wrapper family, their `cellKind`, `family`, and the meaning/order of `key`, `scope`, and `owner` must be identical. Optional `scope` and `owner` must also be identical: either every paired put/get/kill template omits `owner`, or every paired template uses the exact same `owner` template. Do not add a const `owner` to only one side. Do not use `family="project.preference"` for one surface and `family="project.preferences"` for another. Do not put a namespace argument in `key` for `handoff.get` but in `owner` for `handoff.put`. For preference-style `(name, key, value)` / `(name, key, defaultValue)` wrappers, a stable layout is:

```json
{
  "cellKind": "persistent-storage-slot",
  "family": "project.preferences",
  "key": [
    { "kind": "fromEndpoint", "endpoint": { "base": { "kind": "arg", "index": 0 } } },
    { "kind": "fromEndpoint", "endpoint": { "base": { "kind": "arg", "index": 1 } } }
  ],
  "precision": "infer"
}
```

Use the same handle template for both `handoff.put` and `handoff.get`; only `value` versus `target` changes.

Every observed companion surface arity in the same wrapper family must be represented by an analyzer-backed `InvokeSurface`. If the evidence shows both `get(key)` and `get(key, defaultValue)`, include separate `get` surfaces with `argCount: 1` and `argCount: 2` that share the same `handoff.get` handle when the key layout is the same. Do not model only the shortest overload when another observed call shape is the audited consumer; return `need-more-evidence` if the companion arities or handle layout cannot be anchored.

The schema validator rejects a module asset when paired `handoff.put`, `handoff.get`, or `handoff.kill` templates for the same analyzer-backed owner and identical `cellKind`/`key`/`scope`/`owner` layout use different `family` strings. If a repair prompt reports this mismatch, choose one stable project/API namespace and apply that exact `family` to all paired templates. Do not bypass the error by changing the `key`, `scope`, or `owner` layout unless the code evidence really shows a different storage location.

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

For project event-bus or pub/sub wrappers where one API registers callbacks and another dispatches the same channel/key, use a `plane="module"` asset with a registered `module.eventEmitter` effect template. This is for activation semantics such as `EventHub.on(KEY, callback)` paired with `EventHub.sendEvent(KEY)` or `sendEvent(KEY, payload)`. Do not output `core.capability`; it is reserved for built-in or reviewed manual assets.

`module.eventEmitter` uses top-level fields:

```json
{
  "id": "template.ProjectEventHub.eventEmitter",
  "kind": "module.eventEmitter",
  "onMethods": ["on"],
  "emitMethods": ["sendEvent"],
  "channelArgIndexes": [0],
  "payloadArgIndex": -1,
  "callbackArgIndex": 1,
  "callbackParamIndex": 0,
  "confidence": "likely"
}
```

Use `payloadArgIndex: -1` only when the dispatch method activates callbacks without carrying a payload argument. When the dispatch carries a payload, set `payloadArgIndex` to that argument index. The channel or enum key is selector/control metadata, not a sink/source payload by default. Do not model every `on`, `emit`, `send`, or `sendEvent` name; require analyzer-backed companion registration and dispatch evidence, and keep key/owner isolation.

Handoff handles must use the registered handle template shape:

```json
{
  "cellKind": "persistent-storage-slot",
  "family": "project.preferences",
  "key": [
    { "kind": "fromEndpoint", "endpoint": { "base": { "kind": "arg", "index": 0 } } },
    { "kind": "fromEndpoint", "endpoint": { "base": { "kind": "arg", "index": 1 } } }
  ],
  "precision": "infer"
}
```

`cellKind` is mandatory and declares the StateCell shape. Use:

- `keyed-semantic-slot` for in-memory key-value wrappers such as cache, token/session managers, and stable save/load/delete pairs;
- `message-channel-slot` for event bus, emit/on, publish/subscribe, postMessage, and listener payload channels;
- `navigation-param-slot` for route, page, navigation, or router parameter handoff;
- `async-result-slot` for promise, async/await, then, deferred result, and callback-result wrappers;
- `reactive-state-slot` for state management, @State/@Link-like slots, and UI store bindings;
- `resource-handle-slot` for file/DB/request/stream handles;
- `callback-context-slot` for callback registration context slots;
- `global-context-slot` for global/app/ability context stores;
- `persistent-storage-slot` for preferences, files, databases, KV stores, DataShare, and other durable stores.

`family` is only a stable namespace for this project/API, not the cell type. Do not use generic families such as `"storage"`, `"event"`, `"route"`, or `"wrapper"` when a project-specific namespace is available.

Do not output `handle.kind`, `keyExpr`, `storeRef`, or arbitrary handle fields. `handoff.put` uses `value`; `handoff.get` uses `target`.

Omit optional handoff `scope` or `owner` when unknown or when only one paired surface can express it. Never output empty arrays for optional handle fields.

If the matching consume/register surface is missing, return `need-more-evidence` with `kind="q_relation"` or `kind="q_effect"` instead of inventing a broad rule.

## Facade

Use `relations` only for transparent wrappers. A transparent facade must preserve relevant argument, return, and callback endpoints and must have code evidence. If the wrapper sanitizes, rewrites, conditionally drops, partially forwards, or asynchronously changes the payload, do not emit a facade relation.

## Callback and UI Component APIs

Project or third-party UI components may expose callback payloads through option-object callbacks such as `onChange`, `onPhoneChange`, or SDK listener callbacks. Model callback parameters as `rule.source` only when the payload is produced externally and delivered to project code. Use exact callback locators and access paths; do not model every callback parameter because the method name is `on`, `use`, or `subscribe`.

Project UI components that wrap an official input/editor can also be modeled as callback payload sources when the slice shows the component reads user-controlled content and invokes a caller-provided callback with that content, for example `getRichEditorContent()` followed by `onClickSend(content)`. Use `sourceKind="callback_param"` and an exact option-object callback locator. Do not model a callback parameter as a source when the callback merely forwards a value that came from a caller argument, a local constant, or an unrelated internal state.

The callback payload `argIndex` must be derived from the visible callback signature or direct callback invocation in the evidence slice. A callback written as `(content: MessageContent) => { ... }` or invoked as `onClickSend(content)` has one payload parameter, so the endpoint is `argIndex: 0`. Use `argIndex: 1` only when the visible callback has a second parameter and the second parameter is the payload. If the callback declaration or invocation is not visible enough to determine the parameter index, return `need-more-evidence` with `kind="q_endpoint"` instead of guessing.

When such a callback source is registered inside a project component `build()` method that is not proven reachable by existing entry evidence, produce or request a companion `plane="arkmain"` asset for that exact component entry. The arkmain asset should use an `EntrySurface` with the analyzer-backed `ownerName` and `methodName` such as `ChatView.build`, a lifecycle template such as `entry.lifecycle` with `entryKind="page_build"`, and `role="entry"`. Keep the callback payload source in the `rule` asset. Do not broaden the source rule to scan all matching component names or all callbacks.

Callback registration or scheduling belongs to `entry.callbackRegister` or `entry.scheduleUnit`. Callback argument payload transfer belongs to `rule.*` or `handoff.*`, not to the entry effect itself.

When the slice is a resolved project component or ownerless function callback surface with `candidateOrigin=recall_callback_surface`, `callbackOwnerResolved=true`, and owner evidence showing a framework or lifecycle callback such as `Web.onPageEnd`, `onReady`, `onAppear`, `aboutToAppear`, `onComplete`, or `onSuccess` invoking `this.<optionCallback>()`, emit a `plane="arkmain"` asset with `entry.callbackRegister` for the option-object callback. This is a registration/activation asset only. Do not require evidence for the caller callback body, caller receiver fields, downstream sinks, or upstream source writes before returning `done`; those belong to separate rule/module assets and separate coverage gaps. The surface must stay analyzer-backed: use the resolved component/function identity from `methodSignature`, `modulePath`, `functionName` or owner/method fields, observed `argCount`, and the registration caller file in provenance.

For project wrapper methods with trailing optional/default parameters, set `InvokeSurface.argCount` from the observed candidate call shape. If the candidate evidence shows `sendTextMessage(content)` while the declaration is `sendTextMessage(content, flag = false, onError = ..., onSuccess = ...)`, use `argCount: 1` for an `arg0` sink surface. If the evidence models an endpoint at `arg1`, use at least `argCount: 2`. Do not copy the full formal parameter count when the modeled callsite passes fewer arguments.

## Need More Evidence

Return `need-more-evidence` when the wrapper body, companion surface, callback registration, key/route/channel extraction, final sink call, return payload source, or facade transparency is not visible. The `draft` must be a partial v2 asset draft, not an old summary object.
