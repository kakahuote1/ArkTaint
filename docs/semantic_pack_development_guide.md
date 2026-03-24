# Phase 8 Semantic Pack Development Guide

`Phase 8` is for pluggable semantic hardcoding in `L3/L5`: TS/JS library semantics and Harmony special modeling.

The rule is simple:

- If `source/sink/transfer/sanitizer` can express it, use rules.
- If rules cannot express it, write a semantic pack.

## Mental model

One file = one semantic pack.

- Put a normal `.ts` file under `src/packs/**`
- Or load an external directory with `--packs <dir>`
- Delete the file to remove the semantic
- Edit the file to change the semantic
- Disable a pack by id with `--disable-packs <pack-id>`
- Disable the current pack in-file with `enabled: false`

Built-in packs are loaded from `src/packs/**` by recursively scanning TypeScript source files. A special `.pack.ts` suffix is not required.

## Pack shape

```ts
import { defineSemanticPack } from "../kernel/contracts/SemanticPack";

export default defineSemanticPack({
  id: "thirdparty.acme_upload",
  description: "Acme upload callback and payload propagation",
  enabled: true,

  setup(ctx) {
    return {
      onFact(event) {
        return [];
      },

      onInvoke(event) {
        return [];
      },

      shouldSkipCopyEdge(event) {
        return false;
      },
    };
  },
});
```

If a file exports multiple semantic packs, each export is handled independently. This lets one file contain multiple semantics while disabling only one of them:

```ts
export const disabledVariant = defineSemanticPack({
  id: "thirdparty.acme_upload.legacy",
  description: "Old variant kept for reference",
  enabled: false,
});
```

Current pack hooks:

- `setup(ctx)`: build once from `scene/pag`
- `onFact(event)`: when a tainted fact is processed, emit extra facts
- `onInvoke(event)`: when a tainted fact reaches an invoke site, inject invoke-specific semantics
- `shouldSkipCopyEdge(event)`: suppress over-broad copy-edge propagation when needed

## Directory layout

Recommended built-in layout:

```text
src/packs/
  harmony/
    router.ts
    appstorage.ts
    state.ts
  tsjs/
    container.ts
  thirdparty/
    acme_sdk.ts
```

For external packs, any directory containing normal `.ts` files can be passed with:

```bash
node out/cli/analyze.js --repo <repo> --sourceDir . --packs path/to/packs
```

Disable packs by id:

```bash
node out/cli/analyze.js --repo <repo> --sourceDir . --disable-packs harmony.router,thirdparty.acme_upload
```

## Emitting facts

Use `TaintFact` directly or reuse helpers from:

- `src/core/kernel/contracts/PackEmissionUtils.ts`

This is how built-in packs model:

- container semantics
- Harmony router/storage/state/worker/emitter/handoff

## Example

See:

- `examples/semantic-pack/demo-pack/`
- `tests/fixtures/semantic_pack_runtime/`
