# Harmony Metamorphic Report

- generatedAt: 2026-04-07T06:07:11.128Z
- manifest: D:\cursor\workplace\ArkTaint\tests\benchmark\HarmonyBench\manifest.json
- k: 1
- groups: A

## A Group (Strict Equivalence)

- total: 16
- consistent: 16
- inconsistent: 0
- baselineAnalyzeFailures: 0
- mutatedAnalyzeFailures: 0

## B Group (Harmony Challenges)

- total: 0
- TP/FP/TN/FN: 0/0/0/0
- recall: N/A
- precision: N/A
- fp_safe_control: 0/0
- unrelated_sink_hits: 0
- spillover_ratio: N/A

## B Group Fallback Mapping


## Scoring Policy

- Group A: strict equivalence mutations. Baseline and mutation must match under `expected_flow + target sink inventory`.
- Group B: Harmony challenge mutations. Report TP/FP/TN/FN with fallback mapping; 100% consistency is not required.

## Resolution Split

- engine_required: 0
- rule_or_model_precision: 0
- engine_or_rule: 0
- mixed: 0

## Rule vs Engine Split

- can_fix_by_rule_or_model_precision: 0
- must_fix_by_engine_enhancement: 0
- hybrid_or_need_manual_triage: 0

## Failure Evidence (Code Location + Rule Hits + Break Reason)

| Group | Category | Case | Transform | Location | Break Reason | Rule Hits |
| --- | --- | --- | --- | --- | --- | --- |

