# HapBench In ArkTaint

This directory vendors the original `HapBench` cases from `D:\cursor\workplace\HapFlow\HapBench`.

## Rules

- Do not edit the benchmark case files.
- Do not add benchmark-specific rules.
- Do not add benchmark-specific modules.
- Keep the imported case tree structurally identical to the upstream benchmark.

## Oracle

ArkTaint scores HapBench with a thin evaluation wrapper only:

- case expectation is derived from original inline comments:
  - `//sink, leak`
  - `//sink, no leak`
- one case with both labels is treated as a positive case at the case level
- three cases without sink labels use manual overrides from:
  - `oracle_overrides.json`
- benchmark-issue cases whose labels or triggering assumptions conflict with ArkTS/Harmony semantics are recorded in:
  - `oracle_overrides.json`
  - these cases are still executed and reported, but excluded from the main score
  - this also includes cases that mark a leak even though the sink executes before the source assignment in the same method
  - this also includes cases whose leak path relies on unreachable source code branches, skipped parent lifecycle methods, or an alternate sink that is not the benchmark-labeled leak site

## Runner

Use:

- `npm run test:hapbench`

Default output:

- `tmp/test_runs/benchmark/hapbench/latest/report.json`
- `tmp/test_runs/benchmark/hapbench/latest/report.md`

## Comparison Scope

The goal of this lane is direct comparison against HapFlow's benchmark corpus, not reuse of ArkTaint's existing synthetic datasets.
