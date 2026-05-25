---
id: "semanticflow/project-api-modeling"
title: "Project and Third-Party API Modeling"
version: "1.2.10"
---

# Project and Third-Party API Modeling

Use this skill when modeling APIs from a real project, third-party SDK, or project wrapper.

## Source of Semantics

- Official/native semantics: HarmonyOS, OpenHarmony SDK, ArkUI, ArkTS, JavaScript, TypeScript, lifecycle, router, built-in storage, and built-in callbacks.
- Project/third-party semantics: project `ApiClient`, `Http`, `Logger`, `TokenManager`, `CookieManager`, database wrappers, business SDKs, and third-party SDK wrappers.
- Mixed semantics: split the bottom official API from the project wrapper. Do not turn project-private behavior into a universal kernel assumption.

## Modeling Rule

Model the API semantics only. Do not decide final source-to-sink reachability and do not write solver logic.

## Official API Boundary

Do not create project modules for direct calls to official/native APIs that ArkTaint already treats as built-in semantics, including HarmonyOS/OpenHarmony SDK calls, ArkUI callbacks, router APIs, `AppStorage`, `LocalStorage`, `PersistentStorage`, Preferences, RDB, `hilog`, and `console`.

If the candidate method merely contains direct official API calls, classify the candidate itself by its visible role:

- choose `arkmain` only when the method is a framework-created entry, lifecycle callback, scheduler, or framework callback;
- choose `no-transfer` when it is an ordinary helper that only calls built-in APIs and exposes no reusable project-level API surface;
- choose `rule` or `module` only when the project method is itself a reusable wrapper API whose callers rely on that wrapper semantics.

Do not duplicate built-in storage/router/event semantics by inventing project modules for `AppStorage.set`, `AppStorage.setOrCreate`, `AppStorage.get`, `router.pushUrl`, `router.getParams`, `hilog.*`, `console.*`, or similar official calls inside a method body. If a built-in API appears to be missing from ArkTaint, mark the issue as official/native semantic evidence rather than emitting a project wrapper model.

For ArkMain entry modeling:

- Only choose `arkmain` for methods that are actually created, scheduled, or invoked by the framework/runtime, or for callbacks that are explicitly registered with a framework API.
- Do not choose `arkmain` for ordinary project helper methods just because they have framework-looking parameter types, are called from a lifecycle method, or restore data inside a lifecycle method. Such helpers should be reached through the caller's normal call graph.
- A method invoked manually from `onCreate`, `onWindowStageCreate`, `build`, or another known entry is not an independent entry unless the framework also invokes it directly.
- Lifecycle overrides such as `onCreate`, `onWindowStageCreate`, `onWindowStageRestore`, `onDestroy`, component `aboutToAppear`, ArkUI event callbacks, and registered timer/event/listener callbacks may be `arkmain` when the evidence shows framework scheduling.
- If the evidence is only "this helper is called by an entry method", prefer `no-transfer`; do not emit an ArkMain spec.

For project wrappers:

- Model a method as a sink only when the method itself is a stable project/third-party sink wrapper whose direct contract is to emit, persist, send, execute, or disclose caller-provided payloads. Examples include project `Logger.*`, `HttpClient.post`, SQL execution wrappers, file-write wrappers, IPC/send wrappers, and analytics/reporting wrappers.
- Project or third-party UI components may expose callback-style input surfaces such as `IBestField({ onChange: (value) => ... })`, `PhoneInputField({ onPhoneChange: (value) => ... })`, or similar option-object callbacks. Treat these as project/third-party modeling candidates, not built-in ArkUI facts. If the callback parameter is produced by user interaction and passed to project code, model the callback parameter as a source. If the callback only signals an action with no payload, classify it as an entry/callback surface or `no-transfer` according to the available evidence; do not invent a payload source.
- For an option-object callback source, always name the callback property explicitly in the output slot. Use an object slot such as `{ "slot": "callback_param", "callbackArgIndex": 0, "paramIndex": 0, "fieldName": "onChange" }` for `IBestField({ onChange: value => ... })`, or `fieldName: "onPhoneChange"` for `PhoneInputField({ onPhoneChange: value => ... })`. Do not output a bare `callback0.param0` or a broad `callback_param` source for the whole options argument unless all callback fields on that argument carry the same user-input payload.
- For a method-style callback source, keep the concrete callback argument index shown in the observations. For example, `axios.interceptors.response.use(success, failure)` should use `{ "slot": "callback_param", "callbackArgIndex": 0, "paramIndex": 0 }` for the success response payload and `{ "slot": "callback_param", "callbackArgIndex": 1, "paramIndex": 0 }` for the failure/error payload when the code evidence supports those roles. Do not model every callback parameter as a source just because the method name is `use`, `on`, or `subscribe`.
- Do not turn request-interceptor config parameters into new sources by default. A request interceptor usually receives the app's own outbound config; response/error interceptors receive framework-delivered data and can be callback sources when the snippet shows response/error payloads.
- For wrapper UI components, distinguish the outer project callback from the inner third-party component. If a project component merely forwards `IBestField.onChange(value)` to `this.onPhoneChange(value)`, model the reusable callback contract, not the specific page action that consumes it. Do not hardcode one project's component name; infer the role from callback property names, parameter flow, and the component body.
- Do not model ordinary lifecycle methods, permission helpers, UI/window helpers, restoration helpers, routing dispatchers, or methods that only orchestrate built-in APIs as sinks just because a tainted framework parameter flows into the method call.
- Do not model UI rendering/style helpers as sinks. Methods that only build ArkUI layout, switch tab state, set status/navigation bar colors, choose icons/text/color, or call `setSystemBar` are `no-transfer` unless they also forward caller-provided payloads to a real disclosure/execution/storage/network endpoint.
- Do not model page/component action methods as reusable project sinks when they only read local fields and delegate them to a project API wrapper such as `loginApi(...)`, `sendSMSCodeApi(...)`, `reservationApi(...)`, or `HttpClient.post(...)`. Model the reusable API/wrapper surface itself; the page action should be `no-transfer` unless it directly performs the external sink operation.
- If a page/component/controller method builds a payload object, branches on UI state, then calls a deeper project wrapper such as `DatabaseManager.insertData`, `DatabaseManager.updateData`, `Logger.info`, `HttpClient.post`, `loginApi`, or `reservationApi`, do not mark the page/controller method as a sink. The deeper reusable wrapper or direct official sink is the modeled sink; the page/controller method is orchestration and should be `no-transfer` unless it is itself the stable API surface exposed to other code.
- Do not emit duplicate sink rules for both an orchestrator and the deeper wrapper it calls. When the current evidence contains both surfaces, choose the deepest stable effectful wrapper that directly persists, logs, sends, executes, or discloses the payload.
- Permission methods such as `checkAccessToken`, `checkPermissions`, `requestPermissionsFromUser`, and access-token helpers are not sinks unless they forward caller-provided sensitive payloads to a disclosure or execution endpoint. A permission name or permission constant is policy metadata, not user/private payload.
- Restoration or migration helpers that unpack `Want.parameters`, call `AppStorage.*`, `LocalStorage`, or `restoreWindowStage`, and return no caller-visible payload should be `no-transfer` unless the method is a reusable wrapper API with a documented project-level contract.
- Official state/storage calls such as `AppStorage.setOrCreate`, `LocalStorage`, or `restoreWindowStage` do not make the surrounding helper a project sink. If such official APIs need security semantics, that belongs to built-in official assets, not to a generated project sink rule.
- If a wrapper sends an argument or field to network, log, storage, database, IPC, WebView/external URL loading, file, or another external-system API, model that request/input side as a sink over the consumed input even when the method also returns external response data. The target must be the payload argument actually forwarded to the underlying sink, not the whole receiver object or the whole framework callback parameter by default.
- Some project API wrappers both consume request inputs and return data fetched from an external service. Treat these as two separate focused modeling questions when the harness asks for them: request/input focus is a sink rule, returned external-response focus is a source rule over `ret`. Do not collapse the fetched response into an `arg -> ret` transfer unless the return value is actually derived from the caller argument.
- For an ordinary project wrapper candidate without `semanticFocus=external_response_source`, prioritize the request/input side when caller-provided inputs are sent to an external endpoint. Do not answer with a returned-response source for that ordinary candidate if a separate external-response focused candidate exists or is implied by the observations.
- When the harness marks `semanticFocus=external_response_source`, ignore the request payload side and decide only whether the returned value originates from a framework/external response. If yes, emit `classification="rule"`, `ruleKind="source"`, `outputs=["ret"]`, and no inputs/transfers.
- For database/storage write wrappers, distinguish payload slots from selector/control slots. Values buckets, record objects, entity objects, serialized content, buffers, and file bodies are payload sinks. Table names, keys, URIs, `RdbPredicates`, predicates, `where`/filter/condition objects, callbacks, affected-row counts, status booleans, and error objects are not payload sinks by default.
- For RDB-style wrappers such as `update(valueBucket, predicates, callback)`, model only the values bucket or record object as the persistence sink. Do not mark the predicate/filter argument as a sink unless the evidence shows it is raw SQL or executable query text, for example `executeSql(sql)` or string concatenation into an SQL template.
- For insert/update helpers with a leading table/key/URI argument, do not mark that selector argument as the persisted payload. Choose the argument that actually contains the inserted or updated data.
- Internal router/navigation wrappers that only push, replace, pop, back, or dispatch between project pages are not security sinks. Treat them as no-transfer/control surfaces unless they directly disclose payloads to a real external boundary such as WebView URL loading, network, file, log, storage, database, IPC, or cross-device messaging. Route parameters may be carriers for later analysis, but the page-stack push itself is not a source-to-danger sink.
- For simple HTTP/request wrappers such as `loginApi(phone, code) { return http.post('/login', { phone, code }) }`, use `classification="rule"`, `ruleKind="sink"`, `inputs=["arg0","arg1"]`, `outputs=[]`, and `transfers=[]`. Do not use `classification="module"`, `moduleSpec`, `underlyingSink`, `sinkInputSlots`, or natural-language transfer targets for one-surface wrappers that rules can express.
- Generated method names such as `%AM0` or `%AM1` can be real arrow-function wrappers after ArkTS lowering. If the method is in an `api`, `service`, `request`, `client`, or repository-like file and forwards parameters to `http`, `axios`, `request`, `fetch`, SQL, storage, log, or IPC, treat it by its body semantics instead of dismissing it as a compiler helper.
- For rest-parameter wrappers such as `Logger.info(...args)` that forward the rest array to `hilog`/`console`/network/storage, model the rest parameter as the consumed sink input. Do not invent separate rules for every observed callsite arity.
- For logging wrappers with a stable category/tag parameter followed by a message/payload parameter, such as `LogUtil.info(tag, msg, ...args)`, model the message and any forwarded rest payload as sinks, not the tag/category/context argument. The tag/category argument is a log label by default; only model it as a sink when the code clearly treats that slot as the caller-provided log message itself. Do not output all arguments for a logger just because all are passed to `hilog` or `console`.
- For file-write wrappers such as `saveImage(data, type)` or `writeFile(path, content)`, model only the caller-provided file body/content/buffer argument as the sink. Do not mark file extension, mode, path prefix, selector, status callback, or generated output path as a payload sink unless that exact slot is written as file content.
- If a wrapper returns data from an underlying source API or response object, model the visible output as a source or transfer, depending on whether the original input carries the payload.
- If a wrapper stores now and another API reads later, model it as a module, not as a direct one-surface rule.
- If a wrapper stores data in a hidden carrier and later resolves or consumes it through Promise/async state, such as `pending.set(id, promiseResolver)` followed by `pending.get(id).resolve(value)`, do not flatten it into `producer.arg0 -> consumer.ret`. That is a semantic handoff through a carrier. Emit a valid ModuleSpec only if the current schema can express it; otherwise ask for more evidence or mark `need-human-check`.
- If the candidate is a callback field/property invocation such as `this.handler(payload)` or `this.incomingHandler(text)`, do not classify that invoked field/property as a source merely because its argument currently contains external data. The original boundary API is the source; this surface is a callback relay/dispatch point.
- For callback field/property relay, use a module only after companion evidence shows the setter or registration method, such as `setHandler(handler) { this.handler = handler }`. The module should bridge the relay payload argument to the registered callback parameter with receiver/field compatibility; it must not become a broad source rule.
- For callback field/property relay, use the current summary transfer shape unless you can write a fully valid ModuleSpec. A good summary is `transfers: ["handler.arg0 -> setHandler.callback0.param0"]`, `moduleKind: "bridge"`, `relations.trigger.preset: "callback_event"` or `"callback_sync"`, and `relations.constraints: [{ "kind": "same_receiver" }]` when the same object instance matters.
- Do not invent moduleSpec keys such as `registerSurface`, `invokeSurface`, `callbackSlot`, or `argSlot`. Those are explanations, not loadable ArkTaint schema fields.
- If the setter/registration companion is missing, ask for more evidence (`q_comp` or `q_cb`) instead of forcing a resolved source. This prevents project callback relays from being counted as new external sources.
- If the wrapper body, companion method, key, route, callback registration, or sink call is missing, ask for more evidence.
- In `need-more-evidence`, `focus.from` and `focus.to` must be valid ArkTaint slot refs only. Do not write expressions such as `p.resolve(msg)`, `this.pending.get(id).resolve(msg)`, `foo(bar)`, or `map.get(key).field` as focus endpoints. Put such details in `companion`, `carrierHint`, `triggerHint`, `why`, and `ask`.
- In resolved module summaries, `relations.trigger.via` must also be a valid slot ref only. Keep business expressions in `trigger.reason`.
- Companion names are evidence hints, not real endpoint surfaces. Do not write `companion:waitFor.ret`, `surface: "companion:waitFor"`, or `methodName: "companion:waitFor"` as module endpoints. If the real consumer/producer surface is not available, ask for more evidence and put the name in `relations.companions`, `focus.companion`, or `trigger.reason`.

For module output, use only ArkTaint's current ModuleSpec shape shown in the prompt. Do not invent old shorthand objects such as `kind: "keyed_storage"`, `writeMethods`, `readMethods`, or pseudo endpoints like `AppStorage.setOrCreate`. A valid module must describe concrete surfaces and normalized semantics that the loader can replay.

## Non-Goals

- Do not infer vulnerability existence.
- Do not promote temporary project candidates into formal assets.
- Do not create broad source/sink rules just to increase flow count.
- Do not model a status boolean as payload transfer unless the returned value actually contains the payload.
