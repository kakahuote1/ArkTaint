# Context & comprehension test assets

This tree holds **author-maintained, long-lived test assets** for experiments around **context packing**, **skills**, **LLM/session comprehension**, and related tooling. It follows the same contract as the rest of `tests/`: **no runtime outputs here** (write under `tmp/test_runs/...` instead).

## Design reference

Principles and workflow (manifest vs unit tests, output layout, CI layering) are described in:

- [`docs/tests_for_context_comprehension.md`](../../docs/tests_for_context_comprehension.md)

For repository-wide `tests/` layout, see [`tests/README.md`](../README.md).

## Suggested layout

| Path | Purpose |
|------|---------|
| `manifests/` | Lists or JSON manifests that drive batch runs (your own schema; document it in a README here if non-obvious). |
| `fixtures/` | Small static inputs: sample state blocks, raw notes, golden snippets, etc. |
| `expected/` | Optional: expected summaries or hashes for regression (keep small and stable; see [`expected/README.md`](expected/README.md)). |

Test **drivers and assertions** still live under `src/tests/**` (see [`src/tests/README.md`](../../src/tests/README.md)); point them at paths under this directory.

## Outputs

Use a stable prefix such as:

`tmp/test_runs/context_and_comprehension/<suite>/latest/...`

Do not commit those artifacts.
