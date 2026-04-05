# Manifest Layout

`tests/manifests/` stores test manifests only. Do not put workspace files or runtime outputs here.

## Groups

- `datasets/`
  - `dev.list`
  - `holdout.list`
  - `library_semantics.list`
- `metamorphic/`
  - `metamorphic_seed.list`
  - `metamorphic_seed_v2.list`
  - `metamorphic_seed_v3.list`
- `real_projects/`
  - `smoke_projects.json`
  - `smoke_projects_core.json`
  - `smoke_projects_external.json`
- `entry_model/`
  - `main_model_framework_taxonomy.json`
  - `main_model_official_catalog.json`
  - `main_model_development_policy.json`
  - `main_model_pure_entry_taxonomy.json`
  - `main_model_pure_entry_expectations.json`
- `benchmarks/`
  - `harmony_modeling_benchmark.json`
  - `harmony_modeling_expectations.json`

## Notes

- Put each new manifest into an existing group when possible. Do not flatten files back into the root.
- One-off manifests used only during local development should go under `tmp/test_runs/...`, not into this directory.
