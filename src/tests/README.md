# Test Source Layout

`src/tests/` stores test code and harnesses. Runtime outputs must go to `tmp/test_runs/...`.

## Main Families

- `test_analyze_*`
  - analyze CLI, output layout, incremental cache, report mode, diagnostics
- `test_entry_model_*`
  - ArkMain, entry recovery, callback provenance, and real-app structural probes
- `test_harmony_*`
  - Harmony modeling, bridges, and benchmark coverage
- `test_transfer_*`
  - transfer rule precision, conflicts, cache, performance, and comparisons
- `test_*compare_arktan*`
  - focused comparisons against Arktan
- `test_metamorphic*`
  - metamorphic consistency checks

## Supporting Directories

- `helpers/`: shared runners, path helpers, and report utilities
- `metamorphic/`: metamorphic harnesses
- `archive/`: historical scripts, not part of the main regression entrypoints

## Recommended Entrypoints

- diagnostics and extension chain: `npm run test:suite:diagnostics`
- analyze core: `npm run test:suite:analyze-core`
- entry-model core: `npm run test:suite:entry-model-core`
- legacy synthetic baseline: `npm run test:suite:legacy-synthetic`
- imported HapFlow benchmark: `npm run test:hapbench`

## Important Note

`test_context` and `test_full_dataset` are the inherited senior synthetic baseline.
They are not historical trash and must remain runnable as a stable comparison lane.
