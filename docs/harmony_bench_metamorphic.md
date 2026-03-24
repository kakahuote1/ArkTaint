# Harmony Metamorphic Report

- generatedAt: 2026-03-23T06:40:35.371Z
- manifest: D:\cursor\workplace\ArkTaint\tests\benchmark\HarmonyBench\manifest.json
- k: 1
- groups: A,B

## A Group (Strict Equivalence)

- total: 207
- consistent: 207
- inconsistent: 0
- baselineAnalyzeFailures: 0
- mutatedAnalyzeFailures: 0

## B Group (Harmony Challenges)

- total: 430
- TP/FP/TN/FN: 208/180/18/24
- recall: 89.7%
- precision: 53.6%
- fp_safe_control: 20/22
- unrelated_sink_hits: 0
- spillover_ratio: 0.0%

## B Group Fallback Mapping

- 7.8/7.9: FN=15, FP=100
- 7.9: FN=6, FP=40
- 7.8.6/7.9: FN=3, FP=40

## Scoring Policy

- Group A: strict equivalence mutations. Baseline and mutation must match under `expected_flow + expected_sink_pattern`.
- Group B: Harmony challenge mutations. Report TP/FP/TN/FN with fallback mapping; 100% consistency is not required.

## Group B Failed Cases (Top 10)

- C1_Lifecycle/C1_001/b_state_driven: FP, fallback=7.8/7.9
  - location: lifecycle_abilitystage_non_oncreate_016_F.ets
  - rule_hits: src[harmony.extension.form_binding_data:78,harmony.lifecycle.want_param:65] sink[sink.test.method.Sink:122] tr[-]
  - break_reason: over_taint_or_loose_rule
  - suggested: rule_or_model_precision
- C1_Lifecycle/C1_001/b_async_concurrency: FP, fallback=7.8/7.9
  - location: lifecycle_abilitystage_non_oncreate_016_F.ets
  - rule_hits: src[harmony.extension.form_binding_data:78,harmony.lifecycle.want_param:65] sink[sink.test.method.Sink:122] tr[-]
  - break_reason: over_taint_or_loose_rule
  - suggested: rule_or_model_precision
- C1_Lifecycle/C1_001/b_env_escape: FP, fallback=7.8/7.9
  - location: lifecycle_abilitystage_non_oncreate_016_F.ets
  - rule_hits: src[harmony.extension.form_binding_data:78,harmony.lifecycle.want_param:65] sink[sink.test.method.Sink:122] tr[-]
  - break_reason: over_taint_or_loose_rule
  - suggested: rule_or_model_precision
- C1_Lifecycle/C1_001/b_napi_boundary: FP, fallback=7.9
  - location: lifecycle_abilitystage_non_oncreate_016_F.ets
  - rule_hits: src[harmony.extension.form_binding_data:78,harmony.lifecycle.want_param:65] sink[sink.test.method.Sink:122] tr[-]
  - break_reason: over_taint_or_loose_rule
  - suggested: rule_or_model_precision
- C1_Lifecycle/C1_001/b_higher_order_ds: FP, fallback=7.8.6/7.9
  - location: lifecycle_abilitystage_non_oncreate_016_F.ets
  - rule_hits: src[harmony.extension.form_binding_data:78,harmony.lifecycle.want_param:65] sink[sink.test.method.Sink:122] tr[-]
  - break_reason: over_taint_or_loose_rule
  - suggested: rule_or_model_precision
- C1_Lifecycle/C1_001/b_dynamic_dispatch: FP, fallback=7.9
  - location: lifecycle_abilitystage_non_oncreate_016_F.ets
  - rule_hits: src[harmony.extension.form_binding_data:78,harmony.lifecycle.want_param:65] sink[sink.test.method.Sink:122] tr[-]
  - break_reason: over_taint_or_loose_rule
  - suggested: rule_or_model_precision
- C1_Lifecycle/C1_001/b_source_alias_relay: FP, fallback=7.8/7.9
  - location: lifecycle_abilitystage_non_oncreate_016_F.ets
  - rule_hits: src[harmony.extension.form_binding_data:78,harmony.lifecycle.want_param:65] sink[sink.test.method.Sink:122] tr[-]
  - break_reason: over_taint_or_loose_rule
  - suggested: rule_or_model_precision
- C1_Lifecycle/C1_001/b_transfer_nonlinear: FP, fallback=7.8/7.9
  - location: lifecycle_abilitystage_non_oncreate_016_F.ets
  - rule_hits: src[harmony.extension.form_binding_data:78,harmony.lifecycle.want_param:65] sink[sink.test.method.Sink:122] tr[-]
  - break_reason: over_taint_or_loose_rule
  - suggested: rule_or_model_precision
- C1_Lifecycle/C1_001/b_higher_order_ds_safe_control: FP, fallback=7.8.6/7.9
  - location: lifecycle_abilitystage_non_oncreate_016_F.ets
  - rule_hits: src[harmony.extension.form_binding_data:78,harmony.lifecycle.want_param:65] sink[sink.test.method.Sink:122] tr[-]
  - break_reason: over_taint_or_loose_rule
  - suggested: rule_or_model_precision
- C1_Lifecycle/C1_004/b_state_driven: FP, fallback=7.8/7.9
  - location: lifecycle_extension_addform_name_mismatch_012_F.ets
  - rule_hits: src[harmony.extension.form_binding_data:78,harmony.lifecycle.want_param:65] sink[sink.test.method.Sink:122] tr[-]
  - break_reason: over_taint_or_loose_rule
  - suggested: rule_or_model_precision

## Resolution Split

- engine_required: 6
- rule_or_model_precision: 180
- engine_or_rule: 3
- mixed: 15

## Rule vs Engine Split

- can_fix_by_rule_or_model_precision: 180
- must_fix_by_engine_enhancement: 6
- hybrid_or_need_manual_triage: 18

## Failure Evidence (Code Location + Rule Hits + Break Reason)

| Group | Category | Case | Transform | Location | Break Reason | Rule Hits |
| --- | --- | --- | --- | --- | --- | --- |
| B | C1_Lifecycle | C1_001 | b_state_driven | lifecycle_abilitystage_non_oncreate_016_F.ets | over_taint_or_loose_rule | src[harmony.extension.form_binding_data:78,harmony.lifecycle.want_param:65] sink[sink.test.method.Sink:122] tr[-] |
| B | C1_Lifecycle | C1_001 | b_async_concurrency | lifecycle_abilitystage_non_oncreate_016_F.ets | over_taint_or_loose_rule | src[harmony.extension.form_binding_data:78,harmony.lifecycle.want_param:65] sink[sink.test.method.Sink:122] tr[-] |
| B | C1_Lifecycle | C1_001 | b_env_escape | lifecycle_abilitystage_non_oncreate_016_F.ets | over_taint_or_loose_rule | src[harmony.extension.form_binding_data:78,harmony.lifecycle.want_param:65] sink[sink.test.method.Sink:122] tr[-] |
| B | C1_Lifecycle | C1_001 | b_napi_boundary | lifecycle_abilitystage_non_oncreate_016_F.ets | over_taint_or_loose_rule | src[harmony.extension.form_binding_data:78,harmony.lifecycle.want_param:65] sink[sink.test.method.Sink:122] tr[-] |
| B | C1_Lifecycle | C1_001 | b_higher_order_ds | lifecycle_abilitystage_non_oncreate_016_F.ets | over_taint_or_loose_rule | src[harmony.extension.form_binding_data:78,harmony.lifecycle.want_param:65] sink[sink.test.method.Sink:122] tr[-] |
| B | C1_Lifecycle | C1_001 | b_dynamic_dispatch | lifecycle_abilitystage_non_oncreate_016_F.ets | over_taint_or_loose_rule | src[harmony.extension.form_binding_data:78,harmony.lifecycle.want_param:65] sink[sink.test.method.Sink:122] tr[-] |
| B | C1_Lifecycle | C1_001 | b_source_alias_relay | lifecycle_abilitystage_non_oncreate_016_F.ets | over_taint_or_loose_rule | src[harmony.extension.form_binding_data:78,harmony.lifecycle.want_param:65] sink[sink.test.method.Sink:122] tr[-] |
| B | C1_Lifecycle | C1_001 | b_transfer_nonlinear | lifecycle_abilitystage_non_oncreate_016_F.ets | over_taint_or_loose_rule | src[harmony.extension.form_binding_data:78,harmony.lifecycle.want_param:65] sink[sink.test.method.Sink:122] tr[-] |
| B | C1_Lifecycle | C1_001 | b_higher_order_ds_safe_control | lifecycle_abilitystage_non_oncreate_016_F.ets | over_taint_or_loose_rule | src[harmony.extension.form_binding_data:78,harmony.lifecycle.want_param:65] sink[sink.test.method.Sink:122] tr[-] |
| B | C1_Lifecycle | C1_004 | b_state_driven | lifecycle_extension_addform_name_mismatch_012_F.ets | over_taint_or_loose_rule | src[harmony.extension.form_binding_data:78,harmony.lifecycle.want_param:65] sink[sink.test.method.Sink:122] tr[-] |
| B | C1_Lifecycle | C1_004 | b_async_concurrency | lifecycle_extension_addform_name_mismatch_012_F.ets | over_taint_or_loose_rule | src[harmony.extension.form_binding_data:78,harmony.lifecycle.want_param:65] sink[sink.test.method.Sink:122] tr[-] |
| B | C1_Lifecycle | C1_004 | b_env_escape | lifecycle_extension_addform_name_mismatch_012_F.ets | over_taint_or_loose_rule | src[harmony.extension.form_binding_data:78,harmony.lifecycle.want_param:65] sink[sink.test.method.Sink:122] tr[-] |
| B | C1_Lifecycle | C1_004 | b_napi_boundary | lifecycle_extension_addform_name_mismatch_012_F.ets | over_taint_or_loose_rule | src[harmony.extension.form_binding_data:78,harmony.lifecycle.want_param:65] sink[sink.test.method.Sink:122] tr[-] |
| B | C1_Lifecycle | C1_004 | b_higher_order_ds | lifecycle_extension_addform_name_mismatch_012_F.ets | over_taint_or_loose_rule | src[harmony.extension.form_binding_data:78,harmony.lifecycle.want_param:65] sink[sink.test.method.Sink:122] tr[-] |
| B | C1_Lifecycle | C1_004 | b_dynamic_dispatch | lifecycle_extension_addform_name_mismatch_012_F.ets | over_taint_or_loose_rule | src[harmony.extension.form_binding_data:78,harmony.lifecycle.want_param:65] sink[sink.test.method.Sink:122] tr[-] |
| B | C1_Lifecycle | C1_004 | b_source_alias_relay | lifecycle_extension_addform_name_mismatch_012_F.ets | over_taint_or_loose_rule | src[harmony.extension.form_binding_data:78,harmony.lifecycle.want_param:65] sink[sink.test.method.Sink:122] tr[-] |
| B | C1_Lifecycle | C1_004 | b_transfer_nonlinear | lifecycle_extension_addform_name_mismatch_012_F.ets | over_taint_or_loose_rule | src[harmony.extension.form_binding_data:78,harmony.lifecycle.want_param:65] sink[sink.test.method.Sink:122] tr[-] |
| B | C1_Lifecycle | C1_004 | b_higher_order_ds_safe_control | lifecycle_extension_addform_name_mismatch_012_F.ets | over_taint_or_loose_rule | src[harmony.extension.form_binding_data:78,harmony.lifecycle.want_param:65] sink[sink.test.method.Sink:122] tr[-] |
| B | C1_Lifecycle | C1_005 | b_state_driven | lifecycle_extension_addform_safe_sink_019_F.ets | over_taint_or_loose_rule | src[harmony.extension.form_binding_data:78,harmony.lifecycle.want_param:65] sink[sink.test.method.Sink:122] tr[-] |
| B | C1_Lifecycle | C1_005 | b_async_concurrency | lifecycle_extension_addform_safe_sink_019_F.ets | over_taint_or_loose_rule | src[harmony.extension.form_binding_data:78,harmony.lifecycle.want_param:65] sink[sink.test.method.Sink:122] tr[-] |

