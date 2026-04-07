# Test Source Layout

`src/tests/` stores test code and harnesses. Runtime outputs must go to `tmp/test_runs/...`.

## Main Directories

- `analyze/`
  - analyze CLI, report mode, diagnostics, invalid flags, parallel/incremental behavior
- `benchmark/`
  - ArkTaint bench, HapBench, and benchmark runner contracts
- `capability/`
  - capability-pack regression panels
- `compare/`
  - comparisons and generalization checks against Arktan or other baselines
- `datasets/`
  - inherited synthetic dataset runners such as `test_context` and `test_full_dataset`
- `entry_model/`
  - ArkMain core recovery, provenance, and explainability
- `execution_handoff/`
  - execution handoff contracts, audits, proofs, and semantic checks
- `harmony/`
  - Harmony modeling, bridges, lifecycle, and e2e feature suites
- `language/`
  - ordinary-language and call-resolution focused tests
- `precision/`
  - object/array/container/stateful precision suites
- `real_projects/`
  - smoke runs, labeling, and project-rule reduction checks
- `rules/`
  - rule schema, governance, framework families, and source/sink precision
- `runtime/`
  - module/plugin runtime contracts, layer dependency gates, and core runtime checks
- `transfer/`
  - transfer precision, overload, pointer, cache, and performance suites

## Supporting Directories

- `helpers/`
  - shared runners, fixtures, path helpers, and report utilities
- `metamorphic/`
  - metamorphic harnesses and metamorphic suite drivers
- `archive/`
  - historical scripts, not part of the main regression entrypoints

## Recommended Entrypoints

- diagnostics and extension chain: `npm run test:diagnostics`
- analyze core: `npm run test:suite:analyze-core`
- entry-model core: `npm run test:suite:entry-model-core`
- synthetic baseline: `npm run test:suite:synthetic-baseline`
- imported HapFlow benchmark: `npm run test:hapbench`
- integrated ArkTaint benchmark: `npm run test:arktaint-bench`

## Important Note

`datasets/test_context` and `datasets/test_full_dataset` are the inherited senior synthetic baseline.
They are not historical trash and must remain runnable as a stable comparison lane.

## Output Contract

Formal test suites must write their runtime output under `tmp/test_runs/...` and should use the shared test output helper in `helpers/TestOutputContract.ts`.

The preferred entrypoint for new formal suites is `createFormalTestSuite(...)`.
It wraps the common boilerplate for:

- resolving the standard output layout
- creating progress reporters
- writing `report.json` and `report.md`
- emitting `summary.json` and `run.json`
- printing the final console summary

Every formal suite should produce:

- `run.json`
  - minimal machine-readable entrypoint with suite status and artifact paths
- `summary.json`
  - self-explanatory summary for humans and AI without reading test source
- `report.json`
  - full structured result
- `report.md`
  - human-readable report

Long-running or multi-step suites must also produce:

- `progress.json`
- `progress.md`

`summary.json` must explain:

- what the suite validates
- overall pass/fail verdict
- key totals
- major highlights
- failures with reason and next hint when possible

Do not emit bare counters without context. A reader should be able to understand the test result from `summary.json` and `report.md` alone.

Minimal pattern:

```ts
const suite = createFormalTestSuite(outputDir, {
  suite: "example_suite",
  domain: "benchmark",
  title: "Example Suite",
  purpose: "Explain what this suite validates.",
});

const progress = suite.createProgress(totalSteps);
progress.update(0, "prepare");

suite.writeReport(report, renderMarkdown(report));
progress.finish("DONE");

suite.finish({
  status: failures.length > 0 ? "fail" : "pass",
  verdict: failures.length > 0 ? "Suite completed with failures." : "Suite passed.",
  totals: { totalSteps, failures: failures.length },
  failures,
});
```

## Progress Requirement

If a suite may take long enough for a user to wait without feedback, it must expose progress through the shared progress reporter.

At minimum:

- current step and total steps
- current case/project/step label
- elapsed time
- ETA when available
- a textual progress bar in console and in `progress.md`

## Governance Rule

When adding a new formal suite:

- do not invent a one-off output layout
- do not invent a one-off report file naming scheme
- do not omit `summary.json`
- do not omit progress artifacts for long-running suites
- prefer extending the shared helper instead of open-coding a custom output protocol
