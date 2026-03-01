# Harmony Metamorphic Report

- generatedAt: 2026-02-28T02:19:58.505Z
- manifest: D:\cursor\workplace\ArkTaint\tests\benchmark\HarmonyBench\manifest.json
- k: 1
- groups: A,B

## A Group (Strict Equivalence)

- total: 12
- consistent: 12
- inconsistent: 0
- baselineAnalyzeFailures: 0
- mutatedAnalyzeFailures: 0

## B Group (Harmony Challenges)

- total: 25
- TP/FP/TN/FN: 16/0/9/0
- recall: 100.0%
- precision: 100.0%
- fp_safe_control: 0/1
- unrelated_sink_hits: 0
- spillover_ratio: 0.0%

## B Group Fallback Mapping

- 7.8/7.9: FN=0, FP=0
- 7.9: FN=0, FP=0
- 7.8.6/7.9: FN=0, FP=0

## Scoring Policy

- Group A: strict equivalence mutations. Baseline and mutation must match under `expected_flow + expected_sink_pattern`.
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

