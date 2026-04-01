# HapBench In ArkTaint

This directory vendors the original `HapBench` cases from `D:\cursor\workplace\HapFlow\HapBench`.

## Rules

- Do not edit the benchmark case files.
- Do not add benchmark-specific rules.
- Do not add benchmark-specific semantic packs.
- Keep the imported case tree structurally identical to the upstream benchmark.

## Oracle

ArkTaint scores HapBench with a thin evaluation wrapper only:

- case expectation is derived from original inline comments:
  - `//sink, leak`
  - `//sink, no leak`
- one case with both labels is treated as a positive case at the case level
- three cases without sink labels use manual overrides from:
  - `oracle_overrides.json`

## Runner

Use:

- `npm run test:hapbench`

Default output:

- `tmp/test_runs/benchmark/hapbench/latest/report.json`
- `tmp/test_runs/benchmark/hapbench/latest/report.md`

## Comparison Scope

The goal of this lane is direct comparison against HapFlow's benchmark corpus, not reuse of ArkTaint's existing synthetic datasets.
