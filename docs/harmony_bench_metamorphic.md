# Harmony Metamorphic Report

- generatedAt: 2026-03-01T09:48:16.897Z
- manifest: D:\cursor\workplace\ArkTaint\tests\benchmark\HarmonyBench\manifest.json
- k: 1
- groups: A,B

## A Group (Strict Equivalence)

- total: 204
- consistent: 204
- inconsistent: 0
- baselineAnalyzeFailures: 0
- mutatedAnalyzeFailures: 0

## B Group (Harmony Challenges)

- total: 430
- TP/FP/TN/FN: 219/1/197/13
- recall: 94.4%
- precision: 99.5%
- fp_safe_control: 0/22
- unrelated_sink_hits: 0
- spillover_ratio: 0.0%

## B Group Fallback Mapping

- 7.8/7.9: FN=12, FP=0
- 7.9: FN=0, FP=1
- 7.8.6/7.9: FN=1, FP=0

## Scoring Policy

- Group A: strict equivalence mutations. Baseline and mutation must match under `expected_flow + expected_sink_pattern`.
- Group B: Harmony challenge mutations. Report TP/FP/TN/FN with fallback mapping; 100% consistency is not required.

## Group B Failed Cases (Top 10)

- C1_Lifecycle/C1_002/b_state_driven: FN, fallback=7.8/7.9
  - location: lifecycle_abilitystage_oncreate_015_T.ets
  - rule_hits: src[source.harmony.abilitystage.context_call:1] sink[-] tr[-]
  - break_reason: no_flow_reached_sink
  - suggested: mixed
- C1_Lifecycle/C1_002/b_source_alias_relay: FN, fallback=7.8/7.9
  - location: lifecycle_abilitystage_oncreate_015_T.ets
  - rule_hits: src[source.harmony.abilitystage.context_call:1] sink[-] tr[-]
  - break_reason: no_flow_reached_sink
  - suggested: mixed
- C1_Lifecycle/C1_003/b_state_driven: FN, fallback=7.8/7.9
  - location: lifecycle_extension_addform_011_T.ets
  - rule_hits: src[harmony.extension.want_param:1] sink[-] tr[-]
  - break_reason: no_flow_reached_sink
  - suggested: mixed
- C1_Lifecycle/C1_003/b_source_alias_relay: FN, fallback=7.8/7.9
  - location: lifecycle_extension_addform_011_T.ets
  - rule_hits: src[harmony.extension.want_param:1] sink[-] tr[-]
  - break_reason: no_flow_reached_sink
  - suggested: mixed
- C1_Lifecycle/C1_006/b_state_driven: FN, fallback=7.8/7.9
  - location: lifecycle_extension_formbinding_013_T.ets
  - rule_hits: src[harmony.extension.form_binding_data:6] sink[-] tr[-]
  - break_reason: no_flow_reached_sink
  - suggested: mixed
- C1_Lifecycle/C1_006/b_source_alias_relay: FN, fallback=7.8/7.9
  - location: lifecycle_extension_formbinding_013_T.ets
  - rule_hits: src[harmony.extension.form_binding_data:6] sink[-] tr[-]
  - break_reason: no_flow_reached_sink
  - suggested: mixed
- C1_Lifecycle/C1_012/b_state_driven: FN, fallback=7.8/7.9
  - location: lifecycle_router_getparams_009_T.ets
  - rule_hits: src[source.harmony.router.getParams:1] sink[-] tr[-]
  - break_reason: no_flow_reached_sink
  - suggested: mixed
- C1_Lifecycle/C1_012/b_source_alias_relay: FN, fallback=7.8/7.9
  - location: lifecycle_router_getparams_009_T.ets
  - rule_hits: src[source.harmony.router.getParams:1] sink[-] tr[-]
  - break_reason: no_flow_reached_sink
  - suggested: mixed
- C1_Lifecycle/C1_016/b_state_driven: FN, fallback=7.8/7.9
  - location: lifecycle_want_direct_001_T.ets
  - rule_hits: src[harmony.lifecycle.want_param:1] sink[-] tr[-]
  - break_reason: no_flow_reached_sink
  - suggested: mixed
- C1_Lifecycle/C1_016/b_source_alias_relay: FN, fallback=7.8/7.9
  - location: lifecycle_want_direct_001_T.ets
  - rule_hits: src[harmony.lifecycle.want_param:1] sink[-] tr[-]
  - break_reason: no_flow_reached_sink
  - suggested: mixed

## Resolution Split

- engine_required: 0
- rule_or_model_precision: 1
- engine_or_rule: 1
- mixed: 12

## Rule vs Engine Split

- can_fix_by_rule_or_model_precision: 1
- must_fix_by_engine_enhancement: 0
- hybrid_or_need_manual_triage: 13

## Failure Evidence (Code Location + Rule Hits + Break Reason)

| Group | Category | Case | Transform | Location | Break Reason | Rule Hits |
| --- | --- | --- | --- | --- | --- | --- |
| B | C1_Lifecycle | C1_002 | b_state_driven | lifecycle_abilitystage_oncreate_015_T.ets | no_flow_reached_sink | src[source.harmony.abilitystage.context_call:1] sink[-] tr[-] |
| B | C1_Lifecycle | C1_002 | b_source_alias_relay | lifecycle_abilitystage_oncreate_015_T.ets | no_flow_reached_sink | src[source.harmony.abilitystage.context_call:1] sink[-] tr[-] |
| B | C1_Lifecycle | C1_003 | b_state_driven | lifecycle_extension_addform_011_T.ets | no_flow_reached_sink | src[harmony.extension.want_param:1] sink[-] tr[-] |
| B | C1_Lifecycle | C1_003 | b_source_alias_relay | lifecycle_extension_addform_011_T.ets | no_flow_reached_sink | src[harmony.extension.want_param:1] sink[-] tr[-] |
| B | C1_Lifecycle | C1_006 | b_state_driven | lifecycle_extension_formbinding_013_T.ets | no_flow_reached_sink | src[harmony.extension.form_binding_data:6] sink[-] tr[-] |
| B | C1_Lifecycle | C1_006 | b_source_alias_relay | lifecycle_extension_formbinding_013_T.ets | no_flow_reached_sink | src[harmony.extension.form_binding_data:6] sink[-] tr[-] |
| B | C1_Lifecycle | C1_012 | b_state_driven | lifecycle_router_getparams_009_T.ets | no_flow_reached_sink | src[source.harmony.router.getParams:1] sink[-] tr[-] |
| B | C1_Lifecycle | C1_012 | b_source_alias_relay | lifecycle_router_getparams_009_T.ets | no_flow_reached_sink | src[source.harmony.router.getParams:1] sink[-] tr[-] |
| B | C1_Lifecycle | C1_016 | b_state_driven | lifecycle_want_direct_001_T.ets | no_flow_reached_sink | src[harmony.lifecycle.want_param:1] sink[-] tr[-] |
| B | C1_Lifecycle | C1_016 | b_source_alias_relay | lifecycle_want_direct_001_T.ets | no_flow_reached_sink | src[harmony.lifecycle.want_param:1] sink[-] tr[-] |
| B | C2_AppStorage | C2_004 | b_state_driven | appstorage_api_object_set_get_005_T.ets | no_flow_reached_sink | src[source.harmony.appstorage.mock_source:1] sink[-] tr[-] |
| B | C2_AppStorage | C2_004 | b_higher_order_ds | appstorage_api_object_set_get_005_T.ets | no_flow_reached_sink | src[source.harmony.appstorage.mock_source:1] sink[-] tr[-] |
| B | C2_AppStorage | C2_004 | b_source_alias_relay | appstorage_api_object_set_get_005_T.ets | no_flow_reached_sink | src[source.harmony.appstorage.mock_source:1] sink[-] tr[-] |
| B | C4_StateProp | C4_010 | b_dynamic_dispatch | state_prop_multi_param_010_F.ets | over_taint_or_loose_rule | src[source.harmony.state_mgmt.entry_param:1] sink[sink.harmony.state_mgmt.mock_sink:1] tr[-] |

