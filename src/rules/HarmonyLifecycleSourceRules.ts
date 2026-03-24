import { SourceRule } from "../core/rules/RuleSchema";

const extensionMethodRegex = "^(onAddForm|onUpdateForm|onFormEvent|onCastToNormalForm|onRemoveForm|onAcquireFormState|onConnect)$";

export const HARMONY_LIFECYCLE_SOURCE_RULES: SourceRule[] = [
    {
        id: "source.harmony.lifecycle.want.parameters",
        enabled: true,
        description: "Treat UIAbility lifecycle want parameter fields as untrusted external input.",
        tags: ["harmony", "lifecycle", "builtin"],
        match: { kind: "method_name_regex", value: "^(onCreate|onNewWant)$" },
        scope: {
            className: {
                mode: "regex",
                value: "(Ability|AbilityStage|ExtensionAbility)$",
            },
        },
        sourceKind: "entry_param",
        target: { endpoint: "matched_param", path: ["parameters"] },
        paramNameIncludes: ["want"],
        paramTypeIncludes: ["want"],
        paramMatchMode: "name_and_type",
    },
    {
        id: "source.harmony.extension.want.parameters",
        enabled: true,
        description: "Treat extension want parameter fields as untrusted external input.",
        tags: ["harmony", "extension", "builtin"],
        match: { kind: "method_name_regex", value: extensionMethodRegex },
        scope: {
            className: {
                mode: "regex",
                value: "ExtensionAbility$",
            },
        },
        sourceKind: "entry_param",
        target: { endpoint: "matched_param", path: ["parameters"] },
        paramNameIncludes: ["want"],
        paramTypeIncludes: ["want"],
        paramMatchMode: "name_and_type",
    },
    {
        id: "source.harmony.extension.formBindingData.root",
        enabled: true,
        description: "Treat form binding payload root as external input.",
        tags: ["harmony", "extension", "form_binding", "builtin"],
        match: { kind: "method_name_regex", value: extensionMethodRegex },
        scope: {
            className: {
                mode: "regex",
                value: "ExtensionAbility$",
            },
        },
        sourceKind: "entry_param",
        target: "matched_param",
        paramNameIncludes: ["formbindingdata", "form_binding_data", "formdata"],
        paramMatchMode: "name_only",
    },
    {
        id: "source.harmony.extension.formBindingData.data",
        enabled: true,
        description: "Treat form binding payload.data as external input.",
        tags: ["harmony", "extension", "form_binding", "builtin"],
        match: { kind: "method_name_regex", value: extensionMethodRegex },
        scope: {
            className: {
                mode: "regex",
                value: "ExtensionAbility$",
            },
        },
        sourceKind: "entry_param",
        target: { endpoint: "matched_param", path: ["data"] },
        paramNameIncludes: ["formbindingdata", "form_binding_data", "formdata"],
        paramMatchMode: "name_only",
    },
    {
        id: "source.harmony.extension.formBindingData.value",
        enabled: true,
        description: "Treat form binding payload.value as external input.",
        tags: ["harmony", "extension", "form_binding", "builtin"],
        match: { kind: "method_name_regex", value: extensionMethodRegex },
        scope: {
            className: {
                mode: "regex",
                value: "ExtensionAbility$",
            },
        },
        sourceKind: "entry_param",
        target: { endpoint: "matched_param", path: ["value"] },
        paramNameIncludes: ["formbindingdata", "form_binding_data", "formdata"],
        paramMatchMode: "name_only",
    },
    {
        id: "source.harmony.extension.formBindingData.payload",
        enabled: true,
        description: "Treat form binding payload.payload as external input.",
        tags: ["harmony", "extension", "form_binding", "builtin"],
        match: { kind: "method_name_regex", value: extensionMethodRegex },
        scope: {
            className: {
                mode: "regex",
                value: "ExtensionAbility$",
            },
        },
        sourceKind: "entry_param",
        target: { endpoint: "matched_param", path: ["payload"] },
        paramNameIncludes: ["formbindingdata", "form_binding_data", "formdata"],
        paramMatchMode: "name_only",
    },
    {
        id: "source.harmony.extension.formBindingData.content",
        enabled: true,
        description: "Treat form binding payload.content as external input.",
        tags: ["harmony", "extension", "form_binding", "builtin"],
        match: { kind: "method_name_regex", value: extensionMethodRegex },
        scope: {
            className: {
                mode: "regex",
                value: "ExtensionAbility$",
            },
        },
        sourceKind: "entry_param",
        target: { endpoint: "matched_param", path: ["content"] },
        paramNameIncludes: ["formbindingdata", "form_binding_data", "formdata"],
        paramMatchMode: "name_only",
    },
];
