import * as path from "path";
import { Scene } from "../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../arkanalyzer/out/src/Config";
import type { TaintEngineOptions } from "../core/orchestration/TaintPropagationEngine";
import {
    buildEngineForCase,
    collectCaseSeedNodes,
    findCaseMethod,
    resolveCaseMethod,
} from "./helpers/SyntheticCaseHarness";

interface CaseSpec {
    filePath: string;
    expected: boolean;
    engineOptions?: TaintEngineOptions;
}

interface CaseResult {
    name: string;
    expected: boolean;
    detected: boolean;
    seedCount: number;
    pass: boolean;
}

const CASES: CaseSpec[] = [
    {
        filePath: "tests/demo/senior_full/completeness/alias/alias_001_T.ets",
        expected: true,
    },
    {
        filePath: "tests/demo/senior_full/completeness/alias/alias_002_F.ets",
        expected: false,
    },
    {
        filePath: "tests/demo/senior_full/completeness/function_call/closure_function/closure_function_001_T.ets",
        expected: true,
    },
    {
        filePath: "tests/demo/senior_full/completeness/function_call/closure_function/closure_function_002_F.ets",
        expected: false,
    },
    {
        filePath: "tests/adhoc/array_variable_index/array_var_index_same_local_001_T.ets",
        expected: true,
    },
    {
        filePath: "tests/adhoc/array_variable_index/array_var_index_diff_local_002_F.ets",
        expected: false,
    },
    {
        filePath: "tests/adhoc/array_variable_index/array_var_index_alias_local_003_T.ets",
        expected: true,
    },
    {
        filePath: "tests/adhoc/array_variable_index/array_var_index_binop_local_004_T.ets",
        expected: true,
    },
    {
        filePath: "tests/adhoc/ordinary_object_field_chain/nested_field_store_001_T.ets",
        expected: true,
    },
    {
        filePath: "tests/adhoc/ordinary_object_field_chain/nested_field_store_002_F.ets",
        expected: false,
    },
    {
        filePath: "tests/adhoc/ordinary_object_field_chain/nested_array_store_003_T.ets",
        expected: true,
    },
    {
        filePath: "tests/adhoc/ordinary_object_field_chain/nested_array_store_004_F.ets",
        expected: false,
    },
    {
        filePath: "tests/adhoc/ordinary_object_field_chain/deep_field_chain_005_T.ets",
        expected: true,
    },
    {
        filePath: "tests/adhoc/ordinary_object_field_chain/deep_field_chain_006_F.ets",
        expected: false,
    },
    {
        filePath: "tests/adhoc/ordinary_object_field_chain/object_alias_load_007_T.ets",
        expected: true,
    },
    {
        filePath: "tests/adhoc/ordinary_object_field_chain/object_alias_load_008_F.ets",
        expected: false,
    },
    {
        filePath: "tests/adhoc/ordinary_object_field_chain/extracted_nested_alias_009_T.ets",
        expected: true,
    },
    {
        filePath: "tests/adhoc/ordinary_object_field_chain/extracted_nested_alias_010_F.ets",
        expected: false,
    },
    {
        filePath: "tests/adhoc/ordinary_object_field_chain/nested_object_relay_011_T.ets",
        expected: true,
    },
    {
        filePath: "tests/adhoc/ordinary_object_field_chain/nested_object_relay_012_F.ets",
        expected: false,
    },
    {
        filePath: "tests/adhoc/ordinary_alias_language/field_alias_write_001_T.ets",
        expected: true,
    },
    {
        filePath: "tests/adhoc/ordinary_alias_language/field_alias_write_002_F.ets",
        expected: false,
    },
    {
        filePath: "tests/adhoc/ordinary_alias_language/shared_reference_write_003_T.ets",
        expected: true,
    },
    {
        filePath: "tests/adhoc/ordinary_alias_language/shared_reference_write_004_F.ets",
        expected: false,
    },
    {
        filePath: "tests/adhoc/ordinary_alias_language/alias_reassignment_preserve_005_T.ets",
        expected: true,
    },
    {
        filePath: "tests/adhoc/ordinary_alias_language/alias_reassignment_break_006_F.ets",
        expected: false,
    },
    {
        filePath: "tests/adhoc/ordinary_alias_language/shared_reference_rebind_007_T.ets",
        expected: true,
    },
    {
        filePath: "tests/adhoc/ordinary_alias_language/shared_reference_rebind_008_F.ets",
        expected: false,
    },
    {
        filePath: "tests/demo/senior_full/completeness/expression/special_expression/template_literal_001_T.ets",
        expected: true,
    },
    {
        filePath: "tests/demo/senior_full/completeness/expression/special_expression/template_literal_002_F.ets",
        expected: false,
    },
    {
        filePath: "tests/demo/complex_calls/async_alias_chain_001_T.ets",
        expected: true,
    },
    {
        filePath: "tests/demo/complex_calls/async_alias_chain_002_F.ets",
        expected: false,
    },
    {
        filePath: "tests/adhoc/ordinary_async_language/promise_then_callback_alias_001_T.ets",
        expected: true,
    },
    {
        filePath: "tests/adhoc/ordinary_async_language/promise_then_callback_alias_002_F.ets",
        expected: false,
    },
    {
        filePath: "tests/adhoc/ordinary_async_language/await_resolve_local_003_T.ets",
        expected: true,
    },
    {
        filePath: "tests/adhoc/ordinary_async_language/await_resolve_local_004_F.ets",
        expected: false,
    },
    {
        filePath: "tests/adhoc/ordinary_async_language/await_field_carrier_005_T.ets",
        expected: true,
    },
    {
        filePath: "tests/adhoc/ordinary_async_language/await_field_carrier_006_F.ets",
        expected: false,
    },
    {
        filePath: "tests/adhoc/ordinary_async_language/promise_then_reject_callback_007_T.ets",
        expected: true,
    },
    {
        filePath: "tests/adhoc/ordinary_async_language/promise_then_reject_callback_008_F.ets",
        expected: false,
    },
    {
        filePath: "tests/adhoc/ordinary_async_language/promise_catch_returned_callback_009_T.ets",
        expected: true,
    },
    {
        filePath: "tests/adhoc/ordinary_async_language/promise_catch_returned_callback_010_F.ets",
        expected: false,
    },
    {
        filePath: "tests/adhoc/ordinary_async_language/promise_finally_passthrough_011_T.ets",
        expected: true,
    },
    {
        filePath: "tests/adhoc/ordinary_async_language/promise_finally_passthrough_012_F.ets",
        expected: false,
    },
    {
        filePath: "tests/adhoc/ordinary_async_language/await_catch_chain_013_T.ets",
        expected: true,
    },
    {
        filePath: "tests/adhoc/ordinary_async_language/await_catch_chain_014_F.ets",
        expected: false,
    },
    {
        filePath: "tests/demo/senior_full/completeness/expression/special_expression/spread_operator_001_T.ets",
        expected: true,
    },
    {
        filePath: "tests/demo/senior_full/completeness/expression/special_expression/spread_operator_002_F.ets",
        expected: false,
    },
    {
        filePath: "tests/demo/senior_full/completeness/expression/special_expression/optional_chaining_operator_001_T.ets",
        expected: true,
    },
    {
        filePath: "tests/demo/senior_full/completeness/expression/special_expression/optional_chaining_operator_002_F.ets",
        expected: false,
    },
    {
        filePath: "tests/demo/senior_full/completeness/expression/special_expression/nullish_coalescing_001_T.ets",
        expected: true,
    },
    {
        filePath: "tests/demo/senior_full/completeness/expression/special_expression/nullish_coalescing_002_F.ets",
        expected: false,
    },
    {
        filePath: "tests/demo/senior_full/completeness/expression/special_expression/not_null_001_T.ets",
        expected: true,
    },
    {
        filePath: "tests/demo/senior_full/completeness/expression/special_expression/not_null_002_F.ets",
        expected: false,
    },
    {
        filePath: "tests/adhoc/ordinary_expression_language/array_destructuring_001_T.ets",
        expected: true,
    },
    {
        filePath: "tests/adhoc/ordinary_expression_language/array_destructuring_002_F.ets",
        expected: false,
    },
    {
        filePath: "tests/adhoc/ordinary_expression_language/object_destructuring_003_T.ets",
        expected: true,
    },
    {
        filePath: "tests/adhoc/ordinary_expression_language/object_destructuring_004_F.ets",
        expected: false,
    },
    {
        filePath: "tests/adhoc/ordinary_expression_language/string_replace_005_T.ets",
        expected: true,
        engineOptions: { includeBuiltinSemanticPacks: false },
    },
    {
        filePath: "tests/adhoc/ordinary_expression_language/string_replace_006_F.ets",
        expected: false,
        engineOptions: { includeBuiltinSemanticPacks: false },
    },
    {
        filePath: "tests/adhoc/ordinary_expression_language/regex_match_007_T.ets",
        expected: true,
        engineOptions: { includeBuiltinSemanticPacks: false },
    },
    {
        filePath: "tests/adhoc/ordinary_expression_language/regex_match_008_F.ets",
        expected: false,
        engineOptions: { includeBuiltinSemanticPacks: false },
    },
    {
        filePath: "tests/adhoc/ordinary_expression_language/regex_exec_009_T.ets",
        expected: true,
        engineOptions: { includeBuiltinSemanticPacks: false },
    },
    {
        filePath: "tests/adhoc/ordinary_expression_language/regex_exec_010_F.ets",
        expected: false,
        engineOptions: { includeBuiltinSemanticPacks: false },
    },
    {
        filePath: "tests/adhoc/ordinary_callable_language/function_value_alias_001_T.ets",
        expected: true,
    },
    {
        filePath: "tests/adhoc/ordinary_callable_language/function_value_alias_002_F.ets",
        expected: false,
    },
    {
        filePath: "tests/adhoc/ordinary_callable_language/local_function_alias_003_T.ets",
        expected: true,
    },
    {
        filePath: "tests/adhoc/ordinary_callable_language/local_function_alias_004_F.ets",
        expected: false,
    },
    {
        filePath: "tests/adhoc/ordinary_callable_language/anonymous_callable_005_T.ets",
        expected: true,
    },
    {
        filePath: "tests/adhoc/ordinary_callable_language/anonymous_callable_006_F.ets",
        expected: false,
    },
    {
        filePath: "tests/adhoc/ordinary_callable_language/helper_return_callable_007_T.ets",
        expected: true,
    },
    {
        filePath: "tests/adhoc/ordinary_callable_language/helper_return_callable_008_F.ets",
        expected: false,
    },
    {
        filePath: "tests/adhoc/ordinary_callable_language/nested_closure_capture_009_T.ets",
        expected: true,
    },
    {
        filePath: "tests/adhoc/ordinary_callable_language/nested_closure_capture_010_F.ets",
        expected: false,
    },
    {
        filePath: "tests/adhoc/ordinary_callable_language/local_function_factory_011_T.ets",
        expected: true,
    },
    {
        filePath: "tests/adhoc/ordinary_callable_language/local_function_factory_012_F.ets",
        expected: false,
    },
    {
        filePath: "tests/adhoc/ordinary_callable_language/anonymous_object_method_013_T.ets",
        expected: true,
    },
    {
        filePath: "tests/adhoc/ordinary_callable_language/anonymous_object_method_014_F.ets",
        expected: false,
    },
    {
        filePath: "tests/adhoc/ordinary_callable_language/anonymous_object_field_callable_015_T.ets",
        expected: true,
    },
    {
        filePath: "tests/adhoc/ordinary_callable_language/anonymous_object_field_callable_016_F.ets",
        expected: false,
    },
    {
        filePath: "tests/demo/library_semantic_regression/json_stringify_001_T.ets",
        expected: true,
    },
    {
        filePath: "tests/demo/library_semantic_regression/json_stringify_002_F.ets",
        expected: false,
    },
    {
        filePath: "tests/demo/library_semantic_regression/json_roundtrip_001_T.ets",
        expected: true,
    },
    {
        filePath: "tests/demo/library_semantic_regression/json_roundtrip_002_F.ets",
        expected: false,
    },
    {
        filePath: "tests/demo/library_semantic_regression/object_assign_001_T.ets",
        expected: true,
    },
    {
        filePath: "tests/demo/library_semantic_regression/object_assign_002_F.ets",
        expected: false,
    },
    {
        filePath: "tests/adhoc/ordinary_copy_language/structured_clone_001_T.ets",
        expected: true,
    },
    {
        filePath: "tests/adhoc/ordinary_copy_language/structured_clone_002_F.ets",
        expected: false,
    },
    {
        filePath: "tests/adhoc/ordinary_copy_language/json_codec_roundtrip_003_T.ets",
        expected: true,
    },
    {
        filePath: "tests/adhoc/ordinary_copy_language/json_codec_roundtrip_004_F.ets",
        expected: false,
    },
    {
        filePath: "tests/adhoc/ordinary_copy_language/object_assign_multi_source_005_T.ets",
        expected: true,
    },
    {
        filePath: "tests/adhoc/ordinary_copy_language/object_assign_multi_source_006_F.ets",
        expected: false,
    },
    {
        filePath: "tests/adhoc/ordinary_copy_language/array_slice_copy_007_T.ets",
        expected: true,
        engineOptions: { includeBuiltinSemanticPacks: false },
    },
    {
        filePath: "tests/adhoc/ordinary_copy_language/array_slice_copy_008_F.ets",
        expected: false,
        engineOptions: { includeBuiltinSemanticPacks: false },
    },
    {
        filePath: "tests/adhoc/ordinary_copy_language/array_concat_copy_009_T.ets",
        expected: true,
        engineOptions: { includeBuiltinSemanticPacks: false },
    },
    {
        filePath: "tests/adhoc/ordinary_copy_language/array_concat_copy_010_F.ets",
        expected: false,
        engineOptions: { includeBuiltinSemanticPacks: false },
    },
    {
        filePath: "tests/demo/library_semantic_regression/promise_resolve_001_T.ets",
        expected: true,
    },
    {
        filePath: "tests/demo/library_semantic_regression/promise_resolve_002_F.ets",
        expected: false,
    },
    {
        filePath: "tests/demo/library_semantic_regression/promise_reject_001_T.ets",
        expected: true,
    },
    {
        filePath: "tests/demo/library_semantic_regression/promise_reject_002_F.ets",
        expected: false,
    },
    {
        filePath: "tests/demo/library_semantic_regression/promise_all_001_T.ets",
        expected: true,
    },
    {
        filePath: "tests/demo/library_semantic_regression/promise_all_002_F.ets",
        expected: false,
    },
    {
        filePath: "tests/demo/library_semantic_regression/promise_race_001_T.ets",
        expected: true,
    },
    {
        filePath: "tests/demo/library_semantic_regression/promise_any_001_T.ets",
        expected: true,
    },
    {
        filePath: "tests/demo/library_semantic_regression/promise_allSettled_001_T.ets",
        expected: true,
    },
    {
        filePath: "tests/demo/senior_full/completeness/promise_callback/promise_callback_001_T.ets",
        expected: true,
    },
    {
        filePath: "tests/demo/senior_full/completeness/promise_callback/promise_callback_002_F.ets",
        expected: false,
    },
    {
        filePath: "tests/demo/senior_full/completeness/promise_callback/promise_callback_003_T.ets",
        expected: true,
    },
    {
        filePath: "tests/demo/senior_full/completeness/promise_callback/promise_callback_004_F.ets",
        expected: false,
    },
    {
        filePath: "tests/demo/senior_full/completeness/promise_callback/promise_callback_005_T.ets",
        expected: true,
    },
    {
        filePath: "tests/demo/senior_full/completeness/promise_callback/promise_callback_006_F.ets",
        expected: false,
    },
    {
        filePath: "tests/demo/senior_full/completeness/function_call/function_override/constructor_extends_001_T.ets",
        expected: true,
    },
    {
        filePath: "tests/demo/senior_full/completeness/function_call/function_override/constructor_extends_002_F.ets",
        expected: false,
    },
    {
        filePath: "tests/demo/senior_full/completeness/interface_class/simple_class/simple_class_005_T.ets",
        expected: true,
    },
    {
        filePath: "tests/demo/senior_full/completeness/interface_class/simple_class/simple_class_006_F.ets",
        expected: false,
    },
    {
        filePath: "tests/demo/senior_full/completeness/function_call/function_override/polymorphism_001_T.ets",
        expected: true,
    },
    {
        filePath: "tests/demo/senior_full/completeness/function_call/function_override/polymorphism_002_F.ets",
        expected: false,
    },
    {
        filePath: "tests/demo/senior_full/completeness/function_call/static_function/static_function_001_T.ets",
        expected: true,
    },
    {
        filePath: "tests/demo/senior_full/completeness/function_call/static_function/static_function_002_F.ets",
        expected: false,
    },
    {
        filePath: "tests/demo/senior_full/completeness/variable_scope/static_variable/static_variable_001_T.ets",
        expected: true,
    },
    {
        filePath: "tests/demo/senior_full/completeness/variable_scope/static_variable/static_variable_002_F.ets",
        expected: false,
    },
    {
        filePath: "tests/demo/senior_full/completeness/variable_scope/private_variable/private_variable_001_T.ets",
        expected: true,
    },
    {
        filePath: "tests/adhoc/ordinary_class_state_language/field_initializer_001_T.ets",
        expected: true,
    },
    {
        filePath: "tests/adhoc/ordinary_class_state_language/field_initializer_002_F.ets",
        expected: false,
    },
    {
        filePath: "tests/adhoc/ordinary_class_state_language/ctor_helper_writeback_003_T.ets",
        expected: true,
    },
    {
        filePath: "tests/adhoc/ordinary_class_state_language/ctor_helper_writeback_004_F.ets",
        expected: false,
    },
    {
        filePath: "tests/adhoc/ordinary_class_state_language/static_initializer_side_effect_005_T.ets",
        expected: true,
    },
    {
        filePath: "tests/adhoc/ordinary_class_state_language/static_initializer_side_effect_006_F.ets",
        expected: false,
    },
    {
        filePath: "tests/adhoc/ordinary_class_state_language/ctor_static_state_007_T.ets",
        expected: true,
    },
    {
        filePath: "tests/adhoc/ordinary_class_state_language/ctor_static_state_008_F.ets",
        expected: false,
    },
    {
        filePath: "tests/adhoc/ordinary_virtual_dispatch_language/base_virtual_local_001_T.ets",
        expected: true,
    },
    {
        filePath: "tests/adhoc/ordinary_virtual_dispatch_language/base_virtual_local_002_F.ets",
        expected: false,
    },
    {
        filePath: "tests/adhoc/ordinary_virtual_dispatch_language/interface_virtual_local_003_T.ets",
        expected: true,
    },
    {
        filePath: "tests/adhoc/ordinary_virtual_dispatch_language/interface_virtual_local_004_F.ets",
        expected: false,
    },
    {
        filePath: "tests/adhoc/ordinary_virtual_dispatch_language/helper_return_base_005_T.ets",
        expected: true,
    },
    {
        filePath: "tests/adhoc/ordinary_virtual_dispatch_language/helper_return_base_006_F.ets",
        expected: false,
    },
    {
        filePath: "tests/adhoc/ordinary_virtual_dispatch_language/field_carried_interface_007_T.ets",
        expected: true,
    },
    {
        filePath: "tests/adhoc/ordinary_virtual_dispatch_language/field_carried_interface_008_F.ets",
        expected: false,
    },
    {
        filePath: "tests/adhoc/ordinary_virtual_dispatch_language/base_template_method_override_009_T.ets",
        expected: true,
    },
    {
        filePath: "tests/adhoc/ordinary_virtual_dispatch_language/base_template_method_override_010_F.ets",
        expected: false,
    },
    {
        filePath: "tests/demo/senior_full/completeness/interface_class/complex_class/complex_class_001_T.ets",
        expected: true,
    },
    {
        filePath: "tests/demo/senior_full/field_sensitive/references_object/constructor_field_001_T.ets",
        expected: true,
    },
    {
        filePath: "tests/demo/senior_full/field_sensitive/references_object/constructor_field_002_F.ets",
        expected: false,
    },
    {
        filePath: "tests/demo/library_semantic_regression/array_of_001_T.ets",
        expected: true,
        engineOptions: { includeBuiltinSemanticPacks: false },
    },
    {
        filePath: "tests/demo/library_semantic_regression/array_of_002_F.ets",
        expected: false,
        engineOptions: { includeBuiltinSemanticPacks: false },
    },
    {
        filePath: "tests/demo/library_semantic_regression/array_from_001_T.ets",
        expected: true,
        engineOptions: { includeBuiltinSemanticPacks: false },
    },
    {
        filePath: "tests/demo/library_semantic_regression/array_from_002_F.ets",
        expected: false,
        engineOptions: { includeBuiltinSemanticPacks: false },
    },
    {
        filePath: "tests/demo/library_semantic_regression/array_from_mapper_001_T.ets",
        expected: true,
        engineOptions: { includeBuiltinSemanticPacks: false },
    },
    {
        filePath: "tests/demo/library_semantic_regression/array_from_mapper_002_F.ets",
        expected: false,
        engineOptions: { includeBuiltinSemanticPacks: false },
    },
    {
        filePath: "tests/demo/library_semantic_regression/array_flat_001_T.ets",
        expected: true,
        engineOptions: { includeBuiltinSemanticPacks: false },
    },
    {
        filePath: "tests/demo/library_semantic_regression/array_flat_002_F.ets",
        expected: false,
        engineOptions: { includeBuiltinSemanticPacks: false },
    },
    {
        filePath: "tests/demo/library_semantic_regression/array_push_base_001_T.ets",
        expected: true,
        engineOptions: { includeBuiltinSemanticPacks: false },
    },
    {
        filePath: "tests/demo/library_semantic_regression/array_push_base_002_F.ets",
        expected: false,
        engineOptions: { includeBuiltinSemanticPacks: false },
    },
    {
        filePath: "tests/demo/library_semantic_regression/array_splice_001_T.ets",
        expected: true,
        engineOptions: { includeBuiltinSemanticPacks: false },
    },
    {
        filePath: "tests/demo/library_semantic_regression/array_splice_002_F.ets",
        expected: false,
        engineOptions: { includeBuiltinSemanticPacks: false },
    },
    {
        filePath: "tests/demo/senior_full/field_sensitive/container/array_003_T.ets",
        expected: true,
        engineOptions: { includeBuiltinSemanticPacks: false },
    },
    {
        filePath: "tests/demo/senior_full/field_sensitive/container/array_004_F.ets",
        expected: false,
        engineOptions: { includeBuiltinSemanticPacks: false },
    },
    {
        filePath: "tests/demo/senior_full/field_sensitive/container/array_005_T.ets",
        expected: true,
        engineOptions: { includeBuiltinSemanticPacks: false },
    },
    {
        filePath: "tests/demo/senior_full/field_sensitive/container/array_006_F.ets",
        expected: false,
        engineOptions: { includeBuiltinSemanticPacks: false },
    },
    {
        filePath: "tests/demo/senior_full/field_sensitive/container/list_field_sensitive_001_T.ets",
        expected: true,
    },
    {
        filePath: "tests/demo/senior_full/field_sensitive/container/list_field_sensitive_002_F.ets",
        expected: false,
    },
    {
        filePath: "tests/adhoc/ordinary_module_language/module_import_export_001_T.ets",
        expected: true,
    },
    {
        filePath: "tests/adhoc/ordinary_module_language/module_import_export_002_F.ets",
        expected: false,
    },
    {
        filePath: "tests/adhoc/ordinary_module_language/module_static_state_003_T.ets",
        expected: true,
    },
    {
        filePath: "tests/adhoc/ordinary_module_language/module_static_state_004_F.ets",
        expected: false,
    },
    {
        filePath: "tests/adhoc/ordinary_module_language/module_dynamic_import_005_T.ets",
        expected: true,
    },
    {
        filePath: "tests/adhoc/ordinary_module_language/module_dynamic_import_006_F.ets",
        expected: false,
    },
    {
        filePath: "tests/adhoc/ordinary_module_language/module_field_carrier_007_T.ets",
        expected: true,
    },
    {
        filePath: "tests/adhoc/ordinary_module_language/module_field_carrier_008_F.ets",
        expected: false,
    },
    {
        filePath: "tests/adhoc/ordinary_module_language/module_static_field_carrier_009_T.ets",
        expected: true,
    },
    {
        filePath: "tests/adhoc/ordinary_module_language/module_static_field_carrier_010_F.ets",
        expected: false,
    },
    {
        filePath: "tests/adhoc/ordinary_module_language/module_import_binding_011_T.ets",
        expected: true,
        engineOptions: { includeBuiltinSemanticPacks: false },
    },
    {
        filePath: "tests/adhoc/ordinary_module_language/module_import_binding_012_F.ets",
        expected: false,
        engineOptions: { includeBuiltinSemanticPacks: false },
    },
    {
        filePath: "tests/adhoc/ordinary_module_language/module_namespace_import_013_T.ets",
        expected: true,
        engineOptions: { includeBuiltinSemanticPacks: false },
    },
    {
        filePath: "tests/adhoc/ordinary_module_language/module_namespace_import_014_F.ets",
        expected: false,
        engineOptions: { includeBuiltinSemanticPacks: false },
    },
    {
        filePath: "tests/adhoc/ordinary_module_language/module_dynamic_namespace_015_T.ets",
        expected: true,
        engineOptions: { includeBuiltinSemanticPacks: false },
    },
    {
        filePath: "tests/adhoc/ordinary_module_language/module_dynamic_namespace_016_F.ets",
        expected: false,
        engineOptions: { includeBuiltinSemanticPacks: false },
    },
    {
        filePath: "tests/adhoc/ordinary_module_language/module_dynamic_side_effect_017_T.ets",
        expected: true,
        engineOptions: { includeBuiltinSemanticPacks: false },
    },
    {
        filePath: "tests/adhoc/ordinary_module_language/module_dynamic_side_effect_018_F.ets",
        expected: false,
        engineOptions: { includeBuiltinSemanticPacks: false },
    },
    {
        filePath: "tests/adhoc/ordinary_module_language/module_import_binding_shadow_019_F.ets",
        expected: false,
        engineOptions: { includeBuiltinSemanticPacks: false },
    },
    {
        filePath: "tests/adhoc/ordinary_module_language/module_dynamic_side_effect_shadow_020_F.ets",
        expected: false,
        engineOptions: { includeBuiltinSemanticPacks: false },
    },
];

function buildScene(projectDir: string): Scene {
    const config = new SceneConfig();
    config.buildFromProjectDir(projectDir);
    const scene = new Scene();
    scene.buildSceneFromProjectDir(config);
    scene.inferTypes();
    return scene;
}

async function runCase(scene: Scene, testCase: CaseSpec): Promise<CaseResult> {
    const absoluteFile = path.resolve(testCase.filePath);
    const sourceDir = path.dirname(absoluteFile);
    const relativePath = path.relative(sourceDir, absoluteFile);
    const testName = path.basename(absoluteFile, ".ets");
    const entry = resolveCaseMethod(scene, relativePath, testName);
    const entryMethod = findCaseMethod(scene, entry);
    if (!entryMethod) {
        throw new Error(`Entry method not found for ${testCase.filePath}`);
    }

    const engine = await buildEngineForCase(scene, 1, entryMethod, {
        engineOptions: testCase.engineOptions,
        verbose: false,
    });
    const seeds = collectCaseSeedNodes(engine, entryMethod);
    if (seeds.length === 0) {
        return {
            name: testName,
            expected: testCase.expected,
            detected: false,
            seedCount: 0,
            pass: false,
        };
    }

    engine.propagateWithSeeds(seeds);
    const flows = engine.detectSinks("Sink");
    const detected = flows.length > 0;
    return {
        name: testName,
        expected: testCase.expected,
        detected,
        seedCount: seeds.length,
        pass: detected === testCase.expected,
    };
}

async function main(): Promise<void> {
    const results: CaseResult[] = [];

    for (const testCase of CASES) {
        const sourceDir = path.resolve(path.dirname(testCase.filePath));
        const scene = buildScene(sourceDir);
        results.push(await runCase(scene, testCase));
    }

    const passCount = results.filter(r => r.pass).length;
    console.log("====== Ordinary Language Core Test ======");
    console.log(`total_cases=${results.length}`);
    console.log(`pass_cases=${passCount}`);
    console.log(`fail_cases=${results.length - passCount}`);
    for (const result of results) {
        console.log(
            `${result.pass ? "PASS" : "FAIL"} ${result.name} `
            + `expected=${result.expected ? "T" : "F"} `
            + `detected=${result.detected} seeds=${result.seedCount}`,
        );
    }

    if (passCount !== results.length) {
        process.exitCode = 1;
    }
}

main().catch(err => {
    console.error(err);
    process.exitCode = 1;
});
