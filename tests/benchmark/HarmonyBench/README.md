# HarmonyBench

HarmonyBench is a micro-benchmark suite for HarmonyOS ArkTS taint analysis.

## Scope

- C1-C5: Supported categories (scored for main precision/recall).
- C6-C15: Known limitations (scored as observation only, excluded from main recall denominator).

## Current Snapshot (M2.2 Step2)

- Categories: `15`
- Cases: `120` (expanded from `51`)
- Category sizes:
  - `C1_Lifecycle`: 19
  - `C2_AppStorage`: 13
  - `C3_EventActivation`: 11
  - `C4_StateProp`: 9
  - `C5_E2E`: 5
  - `C6_LinkTwoWay`: 5
  - `C7_ProvideConsume`: 5
  - `C8_RouterDynamic`: 5
  - `C9_Watch`: 7
  - `C10_WorkerTaskPool`: 7
  - `C11_EmitterBus`: 7
  - `C12_Preferences`: 7
  - `C13_RelationalStore`: 7
  - `C14_HTTP`: 7
  - `C15_ImplicitFlow`: 6

## Ground Truth Convention

- File suffix `_T.ets` means vulnerable sample.
- File suffix `_F.ets` means safe sample.
- `manifest.json` uses `expected_flow` with the same meaning:
  - `expected_flow=true` is equivalent to vulnerable sample.
  - `expected_flow=false` is equivalent to safe sample.

Runner enforces suffix consistency:

- `_T.ets` must map to `expected_flow=true`.
- `_F.ets` must map to `expected_flow=false`.

## Metrics Mapping

For each scored case:

- `expected_flow=true` and detected flow with sink pattern match -> `TP`
- `expected_flow=true` and no matched flow -> `FN`
- `expected_flow=false` and no flow -> `TN`
- `expected_flow=false` and any flow -> `FP`

Main score only counts categories with `supported=true`.

For unsupported scored `_T` cases, `manifest.json` requires `limitation_note`.
Runner will fail fast if such note is missing.

## Output

`npm run test:harmony-bench` writes:

- `tmp/harmony_bench/report.json`
- `tmp/harmony_bench/report.md`

The markdown report contains a table:

`Category | Supported | Cases | TP | FP | TN | FN | Recall | Precision`

and a `Supported Total` summary row.

## C12-C14 Gate (Hard Constraint)

Run dedicated 2T+2F gate:

- `npm run test:harmony-bench:gate:c12-c14`

Current gate status (2026-02-23):

- `C12_Preferences`: not passed (`precision` below threshold)
- `C13_RelationalStore`: not passed (`recall` below threshold)
- `C14_HTTP`: 2T+2F subset passed, but full category still has FN

Therefore C12-C14 remain `supported=false` in the main manifest.
