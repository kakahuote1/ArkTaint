---
id: "semanticflow/asset-plane-selection"
title: "SemanticFlow Asset Plane Selection"
---

# Asset Plane Selection

Use this skill to choose the `plane` for one generated ArkTaint asset. The plane is part of the asset identity and decides which consumer will later handle its `effectTemplates`.

Plane/effect compatibility is a hard requirement. A generated `rule` asset contains only `rule.*` templates. A generated `module` asset contains `handoff.*` templates or registered `module.*` templates such as `module.eventEmitter`. A generated `arkmain` asset contains only `entry.*` templates. If the needed semantics cross these families, choose the current focused family and return `need-more-evidence` for the missing companion instead of mixing effect families in one asset.

## Rule Plane

Use `plane="rule"` only when one visible API surface can be expressed as a local rule effect:

- `rule.source`: an API return value or callback argument introduces taint.
- `rule.sink`: an argument, receiver, return value, or field is consumed by a disclosure, storage, execution, IPC, file, log, network, database, or similar sink.
- `rule.sanitizer`: the API certainly cleans the value for the relevant sink family.
- `rule.transfer`: a visible value moves directly from one endpoint to another in the same surface.

The asset must contain a concrete `AssetSurface`, one or more `AssetBinding` entries, and matching `rule.*` templates. Do not use broad method-name guesses; use the surface evidence in the slice.

For receiver-field carrier evidence, a `rule` asset is valid only for the current surface's visible final consumption endpoint, such as `receiver.requestHeaders` reaching a log or request boundary. If `carrier-sibling-*`, `carrierCompanion`, or sibling writer/build snippets show that one method writes or derives the receiver field and another method consumes it, a rule-only asset is incomplete. Emit a `module` asset with `handoff.*` templates and `cellKind="object-field"` for that hidden carrier, or return `need-more-evidence` for the companion. A rule asset that replaces visible `carrierRoots` with only broad formal-argument sinks is not a valid receiver-field model.

For that object-field `module` asset, bindings still use `role="handoff"`. Do not invent `role="put"` or `role="get"`. The put/get direction belongs in `effectTemplates[].kind`, and the handle must use the registered shape with `cellKind`, `family`, `key`, and optional `precision`.

For request-wrapper evidence, respect `formalParam=...;semanticRole=...` and `requestWrapperEndpointHint=...` observations when choosing a one-surface `rule.sink`. Method, mode, flag, path, URL, host, route, and endpoint slots are control or destination metadata by default. Prefer payload/header/body/file/buffer/serialized-object/receiver-field endpoints, or return `need-more-evidence` when the endpoint mapping is not proven.

## Module Plane

Use `plane="module"` when the semantics require a semantic handoff or multiple related surfaces:

- storage/router/state/event/promise/wrapper publish-consume behavior;
- matching by key, route, channel, component, receiver, owner, callback, promise, or slot;
- `handoff.put`, `handoff.get`, `handoff.kill`, `handoff.link`, or a registered module effect such as `module.eventEmitter`;
- a project wrapper stores now and another API reads later;
- a callback/property relay requires a registration companion before data can reach the callback.

The model only declares registered module templates and their selectors or handle templates. It must not decide handle compatibility, liveness, epoch, path feasibility, or source-to-sink reachability.

For project event-bus or pub/sub wrappers, use a `module.eventEmitter` template when the slice shows a registration API and a dispatch API over the same key/channel. The template describes activation and payload handoff shape, not a source, sink, vulnerability, or path result. Do not output `core.capability`; that family is reserved for reviewed built-in/manual assets.

## ArkMain Plane

Use `plane="arkmain"` only for framework-managed execution facts:

- lifecycle entry;
- framework-invoked method;
- callback registration;
- schedule/deferred-unit candidate.

Entry effects create entry/callback/schedule candidates only. They do not propagate callback argument data; ordinary transfer or handoff effects handle data movement.

For a project component or third-party UI wrapper, callback payload semantics and entry reachability are separate assets. If the slice proves that a component callback argument is a `rule.source`, but the registration site is inside a framework-managed project component `build()` method that may not already be an entry, also request or generate a companion `arkmain` asset for the exact component `EntrySurface` (`ownerName`, `methodName`, `phase`, `entryKind`). Do not widen the `rule.source` selector to compensate for a missing entry.

For callback payload sources, derive the payload parameter index from the visible callback signature or invocation. A one-parameter callback such as `(content) => ...` or `onClickSend(content)` uses `argIndex: 0`; `argIndex: 1` is valid only when the evidence shows a second callback parameter and that second parameter is the payload. If the parameter position is not visible, request endpoint evidence instead of guessing.

## Decision Rule

Candidate origin, file path, harness recall category, method name, and companion names are evidence, not a preselected plane.

1. If the evidence proves framework/runtime invocation, use `arkmain`.
2. Else if one surface fully expresses source/sink/sanitizer/visible transfer, use `rule`.
3. Else if hidden carriers, companion surfaces, delayed handoff, or binding constraints are required, use `module`.
4. Else return `need-more-evidence` with one bounded request.

Never output old SemanticFlow fields. The only resolved result is `status="done"` with an `asset` containing `surfaces`, `bindings`, `effectTemplates`, optional `relations`, and `provenance`.
