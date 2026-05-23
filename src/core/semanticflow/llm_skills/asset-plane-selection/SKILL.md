---
id: "semanticflow/asset-plane-selection"
title: "SemanticFlow Asset Plane Selection"
version: "1.0.0"
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

3. `arkmain`
   Use only for framework-created execution:
   - ability, stage, extension, page, or component lifecycle entry;
   - framework callback scheduling;
   - page build or component entry ownership.

## Decision Order

1. If the slice describes a framework-managed entry or scheduler, choose `arkmain`.
2. Else if one visible surface fully describes the fact, choose `rule`.
3. Else if hidden state, semantic handoff, companion API, callback/async dispatch, or structural constraints are required, choose `module`.
4. Else choose `need-more-evidence`, `no-transfer`, `wrapper-only`, or `need-human-check`.

Do not use `module` for a simple arg/base/result transfer that `rule` can express.
Do not use `arkmain` for ordinary helpers, wrappers, storage, sources, sinks, or transfers.
