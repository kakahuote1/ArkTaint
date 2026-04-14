import type { SemanticFlowDecisionInput } from "./SemanticFlowTypes";

export interface SemanticFlowPrompt {
    system: string;
    user: string;
}

export interface SemanticFlowRepairPromptInput {
    original: SemanticFlowPrompt;
    validationError: string;
    raw: string;
}

function truncateRepairText(value: string, max: number): string {
    const text = String(value || "").trim();
    if (text.length <= max) {
        return text;
    }
    return `${text.slice(0, max)}\n...(truncated)`;
}

export function buildSemanticFlowPrompt(input: SemanticFlowDecisionInput): SemanticFlowPrompt {
    const { anchor, slice, round, history } = input;

    const system = [
        "You classify one API semantic slice for static taint modeling.",
        "Your job is not to recover a full source-to-sink path.",
        "Your job is to recover a local transfer summary candidate for the anchor surface.",
        "",
        "Return JSON only. No markdown fences. No commentary.",
        "",
        "Valid statuses:",
        '- "done": enough evidence; when resolution=resolved, classification is required',
        '- "need-more-evidence": request one bounded expansion kind',
        '- "reject": only when the candidate itself should be dropped without a usable summary',
        "",
        'Valid classifications: "arkmain", "rule", "module".',
        "",
        "When status=done, return:",
        "{",
        '  "status": "done",',
        '  "classification"?: "arkmain" | "rule" | "module",',
        '  "resolution": "resolved" | "irrelevant" | "no-transfer" | "wrapper-only" | "need-human-check",',
        '  "summary": {',
        '    "inputs": [...],',
        '    "outputs": [...],',
        '    "transfers": [...],',
        '    "confidence": "low" | "medium" | "high",',
        '    "ruleKind"?: "source" | "sink" | "sanitizer" | "transfer",',
        '    "sourceKind"?: "entry_param" | "call_return" | "call_arg" | "field_read" | "callback_param",',
        '    "moduleKind"?: "state" | "pair" | "bridge" | "deferred" | "declarative",',
        '    "relations"?: {',
        '      "companions"?: string[],',
        '      "carrier"?: { "kind": string, "label"?: string },',
        '      "trigger"?: {',
        '        "preset": "callback_sync" | "callback_event" | "promise_fulfilled" | "promise_rejected" | "promise_any" | "declarative_field",',
        '        "via"?: "...slot ref...",',
        '        "reason"?: string',
        '      },',
        '      "constraints"?: [...],',
        '      "entryPattern"?: {',
        '        "phase": "bootstrap" | "composition" | "interaction" | "reactive_handoff" | "teardown",',
        '        "kind": "ability_lifecycle" | "stage_lifecycle" | "extension_lifecycle" | "page_build" | "page_lifecycle" | "callback",',
        '        "ownerKind"?: "ability_owner" | "stage_owner" | "extension_owner" | "component_owner" | "builder_owner" | "unknown_owner",',
        '        "schedule"?: boolean,',
        '        "reason"?: string,',
        '        "entryFamily"?: string,',
        '        "entryShape"?: string',
        '      }',
        '    },',
        '    "moduleSpec"?: { ... }',
        "  },",
        '  "rationale"?: string[]',
        "}",
        "",
        "When status=need-more-evidence, return:",
        "{",
        '  "status": "need-more-evidence",',
        '  "request": {',
        '    "kind": "q_ret" | "q_recv" | "q_cb" | "q_comp" | "q_meta" | "q_wrap",',
        '    "why": string[],',
        '    "ask": string',
        "  }",
        "}",
        "",
        "When status=reject, return:",
        '{ "status": "reject", "reason": string }',
        "",
        "Rules:",
        "- Use resolution=resolved only when the summary is specific enough to generate a stable ArkMain artifact, Rule artifact, or ModuleSpec.",
        "- Use resolution=irrelevant, no-transfer, wrapper-only, or need-human-check when no final artifact should be emitted.",
        "- If resolution is not resolved, classification may be omitted.",
        "- Decision order: first ask whether this is a framework-managed external entry. If yes, use arkmain. Otherwise ask whether one visible anchor surface is enough. If yes, use rule. Only use module when hidden mechanism or cross-surface semantics are necessary.",
        "- Choose classification=rule only when one anchor surface is sufficient and no hidden mechanism is needed.",
        "- For classification=rule, ruleKind is mandatory and moduleSpec/moduleKind must be absent.",
        "- ruleKind=source means taint originates from API output with no tainted input slot; use outputs only and no transfers.",
        "- ruleKind=sink means tainted input is consumed; use inputs only and no transfers.",
        "- ruleKind=sanitizer means taint is stopped or neutralized at this anchor. Do not also model it as a transfer. If taint still reaches a visible output slot, it is not a sanitizer.",
        "- ruleKind=transfer means visible slot-to-slot propagation inside the anchor surface only. Use anchor-local slots only; do not use companion surfaces, carrier state, dispatch, or constraints.",
        "- Any single-surface source, sink, sanitizer, or direct visible transfer belongs to classification=rule, never classification=module.",
        "- A simple one-surface arg/base/result/field transfer belongs to ruleKind=transfer, not module.",
        "- A wrapper around an already-known framework source/sink/transfer should summarize only the wrapper-visible effect. Do not invent hidden internal slots for the wrapped framework state.",
        "- Choose classification=module only when single-surface rule semantics are insufficient because of companion surfaces, carrier state, deferred callback dispatch, or structural constraints.",
        "- classification=module must not include ruleKind/sourceKind or entryPattern.",
        "- For classification=module, prefer returning an explicit moduleSpec whenever the summary already supports one.",
        '- moduleSpec may be either a full ModuleSpec root: { "id": "...", "semantics": [ { ... } ] } or one single semantic object such as { "kind": "keyed_storage", ... }.',
        '- Never invent legacy keys such as writeSurface/readSurface/keySlot/valueSlot/returnSlot/persistence unless they are strictly necessary as shorthand for a keyed_storage semantic.',
        "- If classification=module does not include moduleSpec, it must still include at least one transfer that needs multi-surface, carrier, deferred, or structural semantics.",
        "- If a moduleSpec only encodes one-surface direct bridge semantics that rules can already express, do not use classification=module.",
        "- Do not classify a simple visible arg->ret/base transfer as module; that belongs to ruleKind=transfer.",
        "- Prefer arkmain only for framework-managed external entry semantics.",
        "- classification=arkmain must include relations.entryPattern and must not include ruleKind, moduleKind, moduleSpec, or transfers.",
        "- When classification=arkmain and resolution=resolved, relations.entryPattern must be a full object with phase and kind. Do not return entryPattern as a bare string.",
        "- classification=arkmain is only for framework entry ownership and scheduling. It is not for ordinary wrappers, helpers, or state bridges.",
        "- ModuleSpec semantic kinds allowed here include: bridge, state, declarative_binding, container, ability_handoff, keyed_storage, event_emitter, route_bridge, state_binding.",
        "- For unknown third-party APIs, prefer bridge or state unless the slice clearly matches a higher-level domain semantic.",
        '- Example keyed_storage moduleSpec shorthand: { "kind": "keyed_storage", "writeMethods": [{ "methodName": "put", "valueIndex": 1 }], "readMethods": ["get"] }',
        '- Example event_emitter moduleSpec shorthand: { "kind": "event_emitter", "onMethods": ["on"], "emitMethods": ["emit"], "payloadArgIndex": 1, "callbackArgIndex": 1, "callbackParamIndex": 0 }',
        "- Ask for more evidence only when the current slice is insufficient.",
        "- You may use slot shorthand in summary fields: arg0, arg1, ret, base, callback0.param0, param0, field:name, decorated_field_value.",
        "- Do not invent pseudo slots such as router.state, storage.cell, bus.queue, hidden.value, or carrier.anything.",
        "- Hidden state or carrier facts belong in relations.carrier, relations.constraints, or moduleSpec. They must not appear inside inputs, outputs, or transfers as slot refs.",
        "- If a hidden carrier is necessary but cannot yet be described in valid summary/module terms, ask for more evidence instead of forcing a resolved answer.",
        "- You may use transfer shorthand: arg0 -> ret, companion:set.arg1 -> ret.",
    ].join("\n");

    const user = [
        `anchorId: ${anchor.id}`,
        `surface: ${anchor.surface}`,
        `owner: ${anchor.owner || "-"}`,
        `methodSignature: ${anchor.methodSignature || "-"}`,
        `filePath: ${anchor.filePath || "-"}`,
        `round: ${round}`,
        `historyRounds: ${history.length}`,
        "",
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
        ...slice.snippets.map(snippet => [
            `### ${snippet.label}`,
            snippet.code,
        ].join("\n")),
    ].join("\n");

    return { system, user };
}

export function buildSemanticFlowRepairPrompt(input: SemanticFlowRepairPromptInput): SemanticFlowPrompt {
    const system = [
        "You are repairing a previously invalid JSON response for one API semantic slice.",
        "Return JSON only. No markdown fences. No commentary.",
        "Keep the original semantic intent when it can be expressed by the allowed schema.",
        "If the previous answer used unsupported slot notation or inconsistent structure, minimally rewrite it into valid schema form.",
        "If it cannot be repaired into a stable resolved artifact, return need-more-evidence instead of forcing resolved.",
        "",
        "Allowed slot shorthand only:",
        "- arg0, arg1, ...",
        "- ret",
        "- base",
        "- callback0.param0",
        "- param0",
        "- field:name",
        "- decorated_field_value",
        "",
        "Hard rules:",
        "- Never invent pseudo slots such as router.state, storage.cell, bus.queue, hidden.value, or carrier.anything.",
        "- Hidden carrier/state semantics belong in relations.carrier, relations.constraints, or moduleSpec, not in slot refs.",
        '- moduleSpec may be a full root { "id": "...", "semantics": [ { ... } ] } or one single semantic object { "kind": "...", ... }.',
        '- Do not return legacy free-form moduleSpec objects that are missing kind/semantics structure.',
        "- A wrapper over an already-known framework source/sink/transfer should be summarized only by the wrapper-visible effect.",
        "- If the answer is resolved, keep classification explicit.",
        "- If the answer is a rule, keep moduleSpec/moduleKind/entryPattern absent.",
        "- If the answer is sanitizer, do not also encode transfer to visible outputs.",
        "- If the answer is a module, keep ruleKind/sourceKind/entryPattern absent.",
        "- If the answer is a simple one-surface direct bridge, do not repair it into classification=module.",
        "- If the answer is arkmain, keep ruleKind/moduleKind/moduleSpec/transfers absent and provide a full entryPattern object.",
        "- classification=arkmain requires relations.entryPattern to be a full object with phase and kind.",
    ].join("\n");

    const user = [
        "validation_error:",
        truncateRepairText(input.validationError, 1200),
        "",
        "original_task:",
        truncateRepairText(input.original.user, 12000),
        "",
        "previous_invalid_json:",
        truncateRepairText(input.raw, 6000),
    ].join("\n");

    return { system, user };
}
