# Tests Layout

`tests/` stores long-lived test assets only. Do not write runtime outputs here.

## Directory Roles

- `demo/`: semantic and rule datasets
- `fixtures/`: CLI, runtime, and loader fixtures
- `benchmark/`: benchmark baselines and reference data
- `manifests/`: test manifests, grouped by purpose
- `rules/`: test-only rule files
- `resources/`: other static assets
- `adhoc/`: manual fixtures that still need to be kept

## Manifest Groups

- `manifests/datasets/`: `dev`, `holdout`, `library semantics`
- `manifests/metamorphic/`: metamorphic seeds
- `manifests/real_projects/`: smoke and external project manifests
- `manifests/entry_model/`: ArkMain and pure-entry taxonomy and policy
- `manifests/benchmarks/`: benchmark manifests and expectations

## Runtime Outputs

- Real analyze runs: `output/runs/analyze/...`
- Experiments and retained evaluations: `output/runs/experiments/...`
- Test executions: `tmp/test_runs/<suite>/<case>/latest/...`
- Old `tmp/phaseXX/...` paths are migration leftovers and must not be used for new output

## Imported External Benchmarks

- `benchmark/HarmonyBench/`: ArkTaint-owned benchmark baseline
- `benchmark/HapBench/`: upstream HapFlow benchmark, vendored without case edits

## Legacy Synthetic Baseline

The senior dataset regression is still a first-class baseline and must not be dropped.

- `npm run test:context`
- `npm run test:full`
- `npm run test:suite:legacy-synthetic`
- `npm run verify:legacy-synthetic`

Use this lane to preserve comparability with the original senior dataset, even though the main engineering gate has moved to `verify`.
