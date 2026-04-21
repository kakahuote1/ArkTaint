# ArkTaint Plugin Development Guide

Plugins are for extending the **analysis pipeline itself**.

Use a plugin when you need to:

- add or replace entry discovery
- observe or inject propagation behavior
- add or replace detection logic
- filter, transform, or append final findings
- write start / finish workflow logic around an analysis run

Do **not** use a plugin when a rule or module is enough:

- use `rules` for `source / sink / transfer / sanitizer`
- use `modules` for hard-coded API / framework semantics

See:

- [Rules](./rule_schema.md)
- [Modules](./module_development_guide.md)

## 1. Public Author Entry

External plugins should import only the public author API:

```ts
import { defineEnginePlugin } from "@arktaint/plugin";
```

External plugins may import:

- files inside the same plugin root
- `@arktaint/plugin`

External plugins may **not** import ArkTaint private internals such as:

- `src/core/...`
- `src/kernel/...`
- `src/cli/...`

If they do, the loader rejects them with:

- `PLUGIN_EXTERNAL_PRIVATE_IMPORT`

## 2. Loading Model

Plugins can come from:

- builtin plugins under `src/plugins/`
- external plugin directories / files via `--plugins`
- explicit in-process plugin objects

Loading rules:

- plugin directories are scanned recursively for `.ts`
- only files containing `defineEnginePlugin` are considered
- `enabled: false` disables a plugin at file level
- duplicate plugin names are resolved by last-writer-wins, with warnings

Useful CLI flags:

- `--plugins <dir-or-file[,dir-or-file]>`
- `--disable-plugins <plugin-name[,plugin-name]>`
- `--plugin-isolate <plugin-name[,plugin-name]>`
- `--plugin-dry-run`
- `--plugin-audit`
- `--list-plugins`
- `--explain-plugin <name>`
- `--trace-plugin <name>`

## 3. Minimal Plugin

```ts
import { defineEnginePlugin } from "@arktaint/plugin";

export default defineEnginePlugin({
  name: "demo.observer",
  description: "Observe taint-flow edges during propagation.",

  onPropagation(api) {
    api.onTaintFlow(event => {
      console.log(`${event.reason}: ${event.fromFact.id} -> ${event.toFact.id}`);
    });
  },
});
```

## 4. Lifecycle

Available hooks:

- `onStart(api)`
- `onEntry(api)`
- `onPropagation(api)`
- `onDetection(api)`
- `onResult(api)`
- `onFinish(api)`

Use the smallest hook that matches your need.

## 5. Start Hook

Use `onStart` for:

- adding rules dynamically
- overriding runtime options

Example:

```ts
import { defineEnginePlugin } from "@arktaint/plugin";

export default defineEnginePlugin({
  name: "demo.start_rules",

  onStart(api) {
    api.addSourceRule({
      id: "source.demo",
      sourceKind: "call_return",
      match: { kind: "method_name_equals", value: "Source" },
      target: "result",
    });

    api.setOption("verbose", false);
  },
});
```

Supported rule injection helpers:

- `addRule(kind, rule)`
- `addSourceRule(rule)`
- `addSinkRule(rule)`
- `addTransferRule(rule)`
- `addSanitizerRule(rule)`

## 6. Entry Hook

Use `onEntry` for:

- adding extra entry methods
- replacing the default entry discoverer

Append an entry:

```ts
onEntry(api) {
  const scene = api.getScene();
  const method = scene.getMethods().find(m => m.getName?.() === "pluginOnlyEntry");
  if (method) {
    api.addEntry(method);
  }
}
```

Replace entry discovery:

```ts
onEntry(api) {
  api.replace((scene, fallback) => {
    const base = fallback.discover(scene).orderedMethods;
    return { orderedMethods: base };
  });
}
```

At most one plugin may call `replace(...)` in a given stage.

## 7. Propagation Hook

Use `onPropagation` for:

- observing call edges / taint-flow edges / reached methods
- injecting propagation contributions
- replacing the propagator

Observe:

```ts
onPropagation(api) {
  api.onCallEdge(event => {
    console.log(`${event.callerMethodName} -> ${event.calleeMethodName}`);
  });

  api.onTaintFlow(event => {
    console.log(`${event.reason}: ${event.fromFact.id} -> ${event.toFact.id}`);
  });
}
```

Inject contributions from inside an observer callback:

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

Available propagation mutations:

- `addFlow(...)`
- `addBridge(...)`
- `addSyntheticEdge(...)`
- `enqueueFact(...)`

Important:

- these mutations are only valid inside propagation callbacks
- calling them outside that context throws `PLUGIN_ON_PROPAGATION_INVALID_MUTATION_CONTEXT`

Replace propagation:

```ts
onPropagation(api) {
  api.replace((input, fallback) => {
    const t0 = Date.now();
    const out = fallback.run(input);
    console.log(`propagation_ms=${Date.now() - t0}`);
    return out;
  });
}
```

## 8. Detection Hook

Use `onDetection` for:

- adding extra checks
- replacing sink detection

Add a custom check:

```ts
onDetection(api) {
  api.addCheck("custom-check", ctx => {
    return ctx.detectSinks("Sink");
  });
}
```

Replace detection:

```ts
onDetection(api) {
  api.replace((input, fallback) => {
    return fallback.run(input);
  });
}
```

## 9. Result Hook

Use `onResult` for:

- filtering findings
- transforming findings
- adding findings

```ts
onResult(api) {
  api.filter(flow => {
    return flow.source.includes("test") ? null : flow;
  });
}
```

Other result operations:

- `addFinding(finding)`
- `transform(fn)`

## 10. Finish Hook

Use `onFinish` for:

- exporting a report
- printing stats
- workflow-level finalization

```ts
onFinish(api) {
  const stats = api.getStats();
  console.log(stats.findingCount);
}
```

## 11. Inspection And Audit

List discovered plugins:

```bash
node out/cli/analyze.js \
  --repo <repo> \
  --plugins D:\projects\my_plugins \
  --list-plugins
```

Explain one plugin:

```bash
node out/cli/analyze.js \
  --repo <repo> \
  --plugins D:\projects\my_plugins \
  --explain-plugin demo.observer
```

Trace one plugin during a real run:

```bash
node out/cli/analyze.js \
  --repo <repo> \
  --sourceDir entry/src/main/ets \
  --plugins D:\projects\my_plugins \
  --trace-plugin demo.observer
```

The trace includes:

- hook call counts
- added rules
- observer counts
- added flows / bridges / synthetic edges / facts
- detection check names and run counts
- result filter / transform / add-finding counts

Isolate one plugin:

```bash
node out/cli/analyze.js \
  --repo <repo> \
  --plugins D:\projects\my_plugins \
  --plugin-isolate demo.observer
```

Dry-run plugins:

```bash
node out/cli/analyze.js \
  --repo <repo> \
  --plugins D:\projects\my_plugins \
  --plugin-dry-run
```

Write plugin audit JSON:

```bash
node out/cli/analyze.js \
  --repo <repo> \
  --plugins D:\projects\my_plugins \
  --plugin-audit
```

This writes:

- `audit/plugin_audit.json`

## 12. When To Use A Plugin Instead Of A Module

Write a **module** when you are modeling API / framework semantics such as:

- `arg / base / result / callback / field` taint bridges
- framework-specific hard-coded data movement

Write a **plugin** when you are changing the analysis workflow itself, such as:

- extra entries
- propagation observers or injected contributions
- detection replacement
- final finding filters / transforms

In short:

- module = semantic modeling
- plugin = pipeline control

## 13. Recommended Workflow

1. Confirm that rules and modules are not enough.
2. Start with an observer-style plugin.
3. Use `--trace-plugin` or `--plugin-audit` to confirm it actually runs.
4. Only then consider `replace(...)`.
5. Use `--plugin-isolate` when debugging plugin interactions.

## 14. Anti-Patterns

Avoid:

- using a plugin to model ordinary `source / sink / transfer`
- putting unrelated stages into one large plugin
- using `replace(...)` too early
- relying on private ArkTaint internals from external plugins

## 15. References

- [examples/plugins/timer_and_filter.plugin.ts](/d:/cursor/workplace/ArkTaint/examples/plugins/timer_and_filter.plugin.ts)
- [builtin_demo.ts](/d:/cursor/workplace/ArkTaint/src/plugins/builtin_demo.ts)
- [test_engine_plugin_runtime.ts](/d:/cursor/workplace/ArkTaint/src/tests/runtime/test_engine_plugin_runtime.ts)
