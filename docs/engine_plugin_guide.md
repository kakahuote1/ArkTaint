# Engine Plugin Guide

`Phase 8.5` engine plugins extend the analysis process itself, not `L3/L5` semantic knowledge.

Use an engine plugin when you want to:

- add or replace entry discovery
- observe or replace propagation
- add or replace detection logic
- filter or rewrite findings
- export custom diagnostics at the end of analysis

Do not use an engine plugin when you only need to add `source/sink/transfer/sanitizer` knowledge or `L3/L5` semantic hardcoding. Those belong to rules or `Phase 8` semantic packs.

## Location

- External plugins are loaded with `--plugins <dir-or-file>`
- The current mainline does not ship built-in engine plugins
- A special `.plugin.ts` suffix is not required; normal `.ts` files are enough
- Disable a plugin by name with `--disable-plugins <plugin-name>`
- Disable the current plugin in-file with `enabled: false`

## Minimal plugin

```ts
import { defineEnginePlugin } from "../../src/core/orchestration/plugins/EnginePlugin";

export default defineEnginePlugin({
  name: "demo.observer",
  enabled: true,

  onPropagation(api) {
    api.onTaintFlow(event => {
      console.log(`${event.reason}: ${event.fromFact.id} -> ${event.toFact.id}`);
    });
  },
});
```

If a file exports multiple plugins, each export is treated independently. This makes it possible to keep an old experiment in the same file without loading it:

```ts
export const disabledExperiment = defineEnginePlugin({
  name: "demo.old_experiment",
  enabled: false,
});
```

## Stage hooks

```ts
interface EnginePlugin {
  name: string;
  onStart?(api: StartApi): void;
  onEntry?(api: EntryApi): void;
  onPropagation?(api: PropagationApi): void;
  onDetection?(api: DetectionApi): void;
  onResult?(api: ResultApi): void;
  onFinish?(api: FinishApi): void;
}
```

## Entry stage

```ts
onEntry(api) {
  const scene = api.getScene();
  const method = scene.getMethods().find(m => m.getName?.() === "pluginOnlyEntry");
  if (method) {
    api.addEntry(method);
  }
}
```

To replace entry discovery entirely:

```ts
onEntry(api) {
  api.replace((scene, fallback) => {
    const base = fallback.discover(scene).orderedMethods;
    return { orderedMethods: base };
  });
}
```

At most one `replace(...)` hook is allowed per stage.

## Propagation stage

```ts
onPropagation(api) {
  api.onCallEdge(event => {
    console.log(`${event.callerMethodName} -> ${event.calleeMethodName}`);
  });

  api.onTaintFlow(event => {
    console.log(`${event.reason}: ${event.fromFact.id} -> ${event.toFact.id}`);
  });

  api.replace((input, fallback) => {
    const t0 = Date.now();
    const out = fallback.run(input);
    console.log(`propagation=${Date.now() - t0}ms`);
    return out;
  });
}
```

`PropagationApi` also supports fine-grained injection:

```ts
onPropagation(api) {
  api.onTaintFlow(() => {
    api.addFlow({
      nodeId: 123,
      reason: "Plugin-Flow",
    });
  });
}
```

Available propagation actions:

- `addFlow(...)`
- `addBridge(...)`
- `addSyntheticEdge(...)`
- `enqueueFact(...)`

`PropagationApi` also provides:

- `getScene()`
- `getPag()`

This lets a plugin locate target nodes during propagation and then inject controlled actions without direct access to the raw solver object.

## Start stage: adding rules

```ts
onStart(api) {
  api.addSourceRule({
    id: "source.demo",
    sourceKind: "call_return",
    match: { kind: "method_name_equals", value: "Source" },
    target: "result",
  });
}
```

Or use the unified entry point:

```ts
api.addRule("source", rule);
api.addRule("sink", rule);
api.addRule("transfer", rule);
api.addRule("sanitizer", rule);
```

## Detection and result stages

Current `DetectionApi` and `ResultApi` findings are `TaintFlow` objects.

```ts
onDetection(api) {
  api.addCheck("custom-check", ctx => {
    return ctx.detectSinks("Sink");
  });
}

onResult(api) {
  api.filter(flow => flow.source.includes("test") ? null : flow);
}
```

## CLI

```bash
node out/cli/analyze.js \
  --repo tests/fixtures/engine_plugin_runtime/project \
  --sourceDir . \
  --plugins tests/fixtures/engine_plugin_runtime/external_plugins \
  --plugin-audit
```

Available options:

- `--plugins <dir-or-file>`
- `--disable-plugins <plugin-name[,plugin-name]>`
- `--plugin-isolate <plugin-name[,plugin-name]>`
- `--plugin-dry-run`
- `--plugin-audit`

`--plugin-audit` writes `plugin_audit.json` into the output directory.
