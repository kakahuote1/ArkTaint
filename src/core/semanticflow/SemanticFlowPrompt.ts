import type { SemanticFlowDecisionInput } from "./SemanticFlowTypes";
import { formatSemanticFlowRuntimeSkills } from "./SemanticFlowRuntimeSkills";

export const SEMANTIC_FLOW_PROMPT_SCHEMA_VERSION = 36;

export interface SemanticFlowPrompt {
    system: string;
    user: string;
}

export interface SemanticFlowRepairPromptInput {
    original: SemanticFlowPrompt;
    validationError: string;
    raw: string;
}

export function buildSemanticFlowPrompt(input: SemanticFlowDecisionInput): SemanticFlowPrompt {
    const { anchor, draftId, slice, draft, lastMarker, lastDelta, round, history } = input;
    const runtimeSkills = formatSemanticFlowRuntimeSkills();
    const system = [
        "You are ArkTaint's runtime LLM modeling harness for one API/framework semantic slice.",
        "Your output must be a declarative ArkTaint asset. Do not output executable propagation logic, solver instructions, vulnerability judgements, or final source-to-sink paths.",
        "The engine consumes only assets made of surfaces, bindings, effectTemplates, and relations. Propagation, handoff matching, path reconstruction, and postsolve filtering are handled by ArkTaint.",
        "",
        "Return JSON only. No markdown fences. No commentary.",
        "",
        "Allowed outputs:",
        "1. done: enough evidence to propose one asset.",
        "2. need-more-evidence: one bounded request for missing surface, role, endpoint, effect, relation, or evidence.",
        "3. reject: the candidate is not a useful model asset.",
        "",
        "done output shape:",
        "{",
        '  "status": "done",',
        '  "asset": {',
        '    "id": "project.<stable-id>",',
        '    "plane": "rule" | "module" | "arkmain",',
        '    "status": "llm-generated",',
        '    "surfaces": [ ... ],',
        '    "bindings": [ ... ],',
        '    "effectTemplates": [ ... ],',
        '    "relations": [ ... ],',
        '    "provenance": { "source": "llm", "projectId"?: string, "evidenceLocations"?: [] }',
        "  },",
        '  "rationale"?: string[]',
        "}",
        "",
        "need-more-evidence output shape:",
        "{",
        '  "status": "need-more-evidence",',
        '  "draft"?: { ...partial asset draft... },',
        '  "request": {',
        '    "kind": "q_surface" | "q_role" | "q_endpoint" | "q_effect" | "q_relation" | "q_evidence",',
        '    "why": string[],',
        '    "ask": string',
        "  }",
        "}",
        "",
        'reject output shape: { "status": "reject", "reason": string }',
        "",
        "Asset rules:",
        "- Every done asset must use exactly one plane: rule, module, or arkmain.",
        "- Use plane=rule for one-surface source, sink, sanitizer, or visible transfer semantics.",
        "- Use plane=module for semantic handoff, hidden carriers, multi-surface wrappers, event/promise/state/storage/router protocols, and declarative framework behavior.",
        "- Use plane=arkmain for framework-managed entry, lifecycle, callback registration, scheduling, page, ability, or extension semantics.",
        "- surfaces identify where the asset applies. bindings identify role, endpoint, guard, and referenced templates or relations. effectTemplates declare standard semantic effects. relations describe transparent facade reuse only.",
        "- A surface proposal is not official unless the analyzer can anchor it. Use provenance.source=\"llm\" and status=\"llm-generated\" in your output.",
        "- Surface kinds are strictly: invoke, construct, access, entry, callback, decorator. Never output kind=\"api\", kind=\"method\", kind=\"function\", or free-form surface fields.",
        "- For ordinary method/function calls, use an InvokeSurface: { surfaceId, kind:\"invoke\", modulePath, ownerName?, functionName?, methodName?, invokeKind, argCount, confidence, provenance:{source:\"llm-proposal\", location?:{file,line,column}} }.",
        "- For a directly imported third-party function or ArkUI-style component call, use modulePath from importSource, invokeKind=\"free-function\", and functionName from the called symbol. Do not use invokeKind=\"static\" unless there is a stable ownerName.",
        "- Do not use surface fields named file, owner, method, line, or signature. Use modulePath, ownerName, methodName/functionName, invokeKind, argCount, signatureId, and provenance.location.",
        "- Bindings must use bindingId, surfaceId, assetId, plane, role, completeness, confidence, and effectTemplateRefs or relationRefs. Never use template, effectRef, semanticsRef, or targetTemplate.",
        "- Do not output unregistered effect kinds. Allowed effect kinds are rule.source, rule.sink, rule.sanitizer, rule.transfer, handoff.put, handoff.get, handoff.kill, handoff.link, entry.lifecycle, entry.callbackRegister, entry.scheduleUnit, entry.frameworkInvoke.",
        "- Do not output core.capability. It is only for built-in core assets.",
        "- Do not invent broad assets from names alone. Use the code slice evidence.",
        "- Project or third-party wrappers belong in generated project assets. Do not turn project-private helper behavior into universal kernel assumptions.",
        "- If evidence is insufficient for a stable surface, role, endpoint, effect, or relation, return need-more-evidence.",
        "",
        "Endpoint conventions:",
        '- Argument 0 is { "base": { "kind": "arg", "index": 0 } }.',
        '- Return value is { "base": { "kind": "return" } }.',
        '- Receiver is { "base": { "kind": "receiver" } }.',
        '- Callback argument is { "base": { "kind": "callbackArg", "callback": { "kind": "arg", "index": <callback-arg-index> }, "argIndex": <callback-param-index> } }.',
        '- Option-object callback argument is { "base": { "kind": "callbackArg", "callback": { "kind": "option", "base": { "base": { "kind": "arg", "index": 0 } }, "accessPath": ["onSendMessage"] }, "argIndex": 1 } }.',
        '- Use accessPath for object fields, for example { "base": { "kind": "arg", "index": 0 }, "accessPath": ["headers", "Authorization"] }.',
        "",
        "Effect guidance:",
        "- rule.source: use when taint originates from an API output or callback payload.",
        "- rule.sink: use when caller-controlled input is disclosed/stored/sent/executed by the API. A sink endpoint must be consumed input such as receiver, arg, or callbackArg; never model return/promiseResult/constructorResult/callbackReturn as a sink.",
        "- rule.sanitizer: use only for certain sanitization; formatting, stringify, toString, substring, encoding, validation-style names, or logging are not sanitizers by themselves.",
        "- rule.transfer: use only for visible same-call value movement.",
        "- Rule effect templates use value/from/to fields. For rule.sink and rule.sanitizer, put the payload endpoint in value, or omit value only when the binding.endpoint already names the same payload. Never put endpoint directly on an effectTemplate.",
        "- rule.source templates must include kind:\"rule.source\", sourceKind, and value. Do not put rule.source in sourceKind. sourceKind must be one of seed_local_name, entry_param, call_return, call_arg, field_read, callback_param, or bound_state.",
        "- If a wrapper logs or stores an internal local or awaited result before returning it, do not model the wrapper return as a sink. Model the actual known sink if needed, or model the wrapper return as source only when evidence shows external data is returned.",
        "- handoff.*: use for publish/consume/kill/link through storage, route, slot, event, promise, or wrapper handles. The model declares handle templates; ArkTaint matches handles and liveness.",
        "- Handoff handles must have shape { family:\"storage\"|\"route\"|\"slot\"|\"event\"|\"promise\"|\"wrapper\", key:[...], scope?:[], owner?:[], precision?:\"infer\"|\"exact\"|\"partial\"|\"unknown\" }. Never use handle.kind, keyExpr, storeRef, or arbitrary handle fields.",
        "- Omit optional handoff scope/owner when unknown. Do not output empty scope or owner arrays.",
        "- Handoff key parts must use kind const, fromEndpoint, fromEndpointPath, fromLiteralArg, fromRouteTarget, fromCallbackChannel, or unknown.",
        "- handoff.put uses value. handoff.get uses target. handoff.kill uses handle. handoff.link uses left and right.",
        "- entry.*: use for entry/callback/schedule facts only. Do not use entry effects to propagate callback argument data.",
        "- facade relations are for transparent wrappers only. If a wrapper transforms, sanitizes, conditionally drops, or partially forwards data, do not model it as a transparent facade.",
        "",
        "Minimal valid invoke + handoff.get example:",
        "{",
        '  "status": "done",',
        '  "asset": {',
        '    "id": "project.PreferenceUtils.preferenceGet",',
        '    "plane": "module",',
        '    "status": "llm-generated",',
        '    "surfaces": [{',
        '      "surfaceId": "surface.PreferenceUtils.getPreferenceValue",',
        '      "kind": "invoke",',
        '      "modulePath": "entry/src/main/ets/utils/PreferenceUtil.ets",',
        '      "ownerName": "PreferenceUtils",',
        '      "methodName": "getPreferenceValue",',
        '      "invokeKind": "instance",',
        '      "argCount": 2,',
        '      "confidence": "likely",',
        '      "provenance": { "source": "llm-proposal", "location": { "file": "entry/src/main/ets/utils/PreferenceUtil.ets", "line": 33 } }',
        "    }],",
        '    "bindings": [{',
        '      "bindingId": "binding.PreferenceUtils.getPreferenceValue.handoffGet",',
        '      "surfaceId": "surface.PreferenceUtils.getPreferenceValue",',
        '      "assetId": "project.PreferenceUtils.preferenceGet",',
        '      "plane": "module",',
        '      "role": "handoff",',
        '      "endpoint": { "base": { "kind": "return" } },',
        '      "effectTemplateRefs": ["template.PreferenceUtils.getPreferenceValue.get"],',
        '      "semanticsFamily": "project.preference",',
        '      "completeness": "partial",',
        '      "confidence": "likely"',
        "    }],",
        '    "effectTemplates": [{',
        '      "id": "template.PreferenceUtils.getPreferenceValue.get",',
        '      "kind": "handoff.get",',
        '      "handle": { "family": "storage", "key": [{ "kind": "fromEndpoint", "endpoint": { "base": { "kind": "arg", "index": 0 } } }], "owner": [{ "kind": "const", "value": "PreferenceUtils.pref" }], "precision": "infer" },',
        '      "target": { "base": { "kind": "return" } },',
        '      "confidence": "likely"',
        "    }],",
        '    "relations": [],',
        '    "provenance": { "source": "llm", "evidenceLocations": [{ "file": "entry/src/main/ets/utils/PreferenceUtil.ets", "line": 33 }] }',
        "  }",
        "}",
        "",
        "Minimal valid third-party option callback source example:",
        "{",
        '  "id": "template.Chat.onSendMessage.arg1.source",',
        '  "kind": "rule.source",',
        '  "sourceKind": "callback_param",',
        '  "value": { "base": { "kind": "callbackArg", "callback": { "kind": "option", "base": { "base": { "kind": "arg", "index": 0 } }, "accessPath": ["onSendMessage"] }, "argIndex": 1 } },',
        '  "confidence": "likely"',
        "}",
        "",
        "Loaded runtime LLM skills from src/core/semanticflow/llm_skills:",
        runtimeSkills,
    ].join("\n");

    const user = [
        `anchorId: ${anchor.id}`,
        `surface: ${anchor.surface}`,
        `owner: ${anchor.owner || "-"}`,
        `methodSignature: ${anchor.methodSignature || "-"}`,
        `filePath: ${anchor.filePath || "-"}`,
        `metaTags: ${(anchor.metaTags || []).join(",") || "-"}`,
        `draftId: ${draftId}`,
        `round: ${round}`,
        `historyRounds: ${history.length}`,
        "",
        ...(draft ? [
            "currentAssetDraft:",
            JSON.stringify(draft, null, 2),
            "",
        ] : []),
        ...(lastMarker ? [
            "lastMarker:",
            JSON.stringify(lastMarker, null, 2),
            "",
        ] : []),
        ...(lastDelta ? [
            "lastDelta:",
            JSON.stringify(lastDelta, null, 2),
            "",
        ] : []),
        "observations:",
        ...slice.observations.map(item => `- ${item}`),
        "",
        ...(slice.companions?.length ? [
            "companions:",
            ...slice.companions.map(item => `- ${item}`),
            "",
        ] : []),
        ...(slice.notes?.length ? [
            "notes:",
            ...slice.notes.map(item => `- ${item}`),
            "",
        ] : []),
        "snippets:",
        ...slice.snippets.flatMap(snippet => [
            `--- ${snippet.label} ---`,
            snippet.code,
        ]),
    ].join("\n");

    return { system, user };
}

export function buildSemanticFlowRepairPrompt(input: SemanticFlowRepairPromptInput): SemanticFlowPrompt {
    const system = [
        "Repair the previous ArkTaint semantic asset-modeling JSON output.",
        "Return JSON only. No markdown fences. No commentary.",
        "The repaired output must be one of: done with an asset, need-more-evidence with one structured request, or reject with a reason.",
        "Do not introduce fields outside the declarative asset model.",
        "Registered surface kinds are only invoke, construct, access, entry, callback, decorator. Replace kind=\"api\" or free-form surface records with a valid InvokeSurface when the evidence is a method call.",
        "Bindings must reference templates via effectTemplateRefs. Handoff handles must use family/key/scope/owner/precision, not handle.kind/keyExpr/storeRef.",
        "Rule effect templates must use value/from/to; never put endpoint directly on a rule.source/rule.sink/rule.sanitizer/rule.transfer template.",
        "rule.source must have kind:\"rule.source\", sourceKind, and value. sourceKind must be seed_local_name, entry_param, call_return, call_arg, field_read, callback_param, or bound_state. Option callback locators must use callback:{kind:\"option\", base:{base:{kind:\"arg\",index:0}}, accessPath:[...]}.",
        "Do not output executable logic or core capabilities.",
    ].join("\n");
    const user = [
        "validationError:",
        input.validationError,
        "",
        "originalSystem:",
        truncateRepairText(input.original.system, 4000),
        "",
        "originalUser:",
        truncateRepairText(input.original.user, 4000),
        "",
        "invalidRaw:",
        truncateRepairText(input.raw, 4000),
    ].join("\n");
    return { system, user };
}

function truncateRepairText(value: string, max: number): string {
    const text = String(value || "").trim();
    if (text.length <= max) {
        return text;
    }
    return `${text.slice(0, max)}\n...(truncated)`;
}
