---
id: "semanticflow/asset-plane-selection"
title: "SemanticFlow Asset Plane Selection"
version: "1.0.4"
---

# Asset Plane Selection

Use this skill to decide which ArkTaint model plane a candidate API semantic belongs to.

## Planes

1. `rule`
   Use for one visible API surface:
   - API output or callback parameter is a source.
   - API input/base/result is a sink.
   - API certainly sanitizes a value for the relevant sink family.
   - One visible input slot directly transfers to one visible output slot.

2. `module`
   Use when one surface is not enough:
- data is published and later consumed through storage, route, event, async result, declarative state, container, or project wrapper state;
- matching depends on key, route, channel, owner, receiver, component, field, callback, promise, or another companion surface;
- callback/deferred output cannot be represented by a plain one-surface transfer rule.
- a callback field/property invocation such as `this.handler(payload)` must be connected to a separate setter/register surface that stored the callback.

3. `arkmain`
   Use only for framework-created execution:
   - ability, stage, extension, page, or component lifecycle entry;
   - framework callback scheduling;
   - page build or component entry ownership.

## Decision Order

Candidate origin, recall category, file path, method name, and harness tags are evidence only. They do not preselect the output plane.

1. If the slice describes a framework-managed entry or scheduler, choose `arkmain`.
2. Else if one visible surface fully describes the fact, choose `rule`.
3. Else if hidden state, semantic handoff, companion API, callback/async dispatch, or structural constraints are required, choose `module`.
4. Else choose `need-more-evidence`, `no-transfer`, `wrapper-only`, or `need-human-check`.

Do not use `module` for a simple arg/base/result transfer that `rule` can express.
Do not use `arkmain` for ordinary helpers, wrappers, storage, sources, sinks, or transfers.
Do not use `rule/source` for a project callback field invocation when the payload source is an upstream API; ask for the setter/register companion or use a module.
When a callback field/property relay uses a module, express the bridge with current summary transfers such as `handler.arg0 -> setHandler.callback0.param0` unless you can emit a full valid ModuleSpec. Do not invent non-schema moduleSpec keys.
Companion names are hints only. Do not use `companion:*` as a real endpoint surface in inputs, outputs, transfers, or ModuleSpec surfaces; ask for more evidence when only a companion name is known.
Hidden carrier plus Promise/deferred state is not a plain bridge. Do not flatten `pending/resolve/wait` semantics into `arg -> ret`; use a valid ModuleSpec or request more evidence.
