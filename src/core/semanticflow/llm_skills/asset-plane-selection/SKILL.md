---
id: "semanticflow/asset-plane-selection"
title: "SemanticFlow Asset Plane Selection"
---

# Asset Plane Selection

Use this skill to choose the `plane` for one generated ArkTaint asset. The plane is part of the asset identity and decides which consumer will later handle its `effectTemplates`.

## Rule Plane

Use `plane="rule"` only when one visible API surface can be expressed as a local rule effect:

- `rule.source`: an API return value or callback argument introduces taint.
- `rule.sink`: an argument, receiver, return value, or field is consumed by a disclosure, storage, execution, IPC, file, log, network, database, or similar sink.
- `rule.sanitizer`: the API certainly cleans the value for the relevant sink family.
- `rule.transfer`: a visible value moves directly from one endpoint to another in the same surface.

The asset must contain a concrete `AssetSurface`, one or more `AssetBinding` entries, and matching `rule.*` templates. Do not use broad method-name guesses; use the surface evidence in the slice.

## Module Plane

Use `plane="module"` when the semantics require a semantic handoff or multiple related surfaces:

- storage/router/state/event/promise/wrapper publish-consume behavior;
- matching by key, route, channel, component, receiver, owner, callback, promise, or slot;
- `handoff.put`, `handoff.get`, `handoff.kill`, or `handoff.link`;
- a project wrapper stores now and another API reads later;
- a callback/property relay requires a registration companion before data can reach the callback.

The model only declares `handoff.*` templates and handle templates. It must not decide handle compatibility, liveness, epoch, path feasibility, or source-to-sink reachability.

## ArkMain Plane

Use `plane="arkmain"` only for framework-managed execution facts:

- lifecycle entry;
- framework-invoked method;
- callback registration;
- schedule/deferred-unit candidate.

Entry effects create entry/callback/schedule candidates only. They do not propagate callback argument data; ordinary transfer or handoff effects handle data movement.

## Decision Rule

Candidate origin, file path, harness recall category, method name, and companion names are evidence, not a preselected plane.

1. If the evidence proves framework/runtime invocation, use `arkmain`.
2. Else if one surface fully expresses source/sink/sanitizer/visible transfer, use `rule`.
3. Else if hidden carriers, companion surfaces, delayed handoff, or binding constraints are required, use `module`.
4. Else return `need-more-evidence` with one bounded request.

Never output old SemanticFlow fields. The only resolved result is `status="done"` with an `asset` containing `surfaces`, `bindings`, `effectTemplates`, optional `relations`, and `provenance`.
