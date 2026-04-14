import type { ArkMainEntryCandidate } from "../entry/arkmain/llm/ArkMainEntryCandidateTypes";
import type { NormalizedCallsiteItem } from "../model/callsite/callsiteContextSlices";
import { buildSemanticFlowArkMainCandidateItem, buildSemanticFlowRuleCandidateItem } from "./SemanticFlowAdapters";
import { createSemanticFlowDelta } from "./SemanticFlowIncremental";
import { buildRuleCandidateCompanionGroups, semanticFlowRuleCandidateKey } from "./SemanticFlowRuleCompanions";
import type { SemanticFlowExpander } from "./SemanticFlowTypes";

export function createRuleCandidateExpander(
    candidates: NormalizedCallsiteItem[],
): SemanticFlowExpander {
    const candidateByAnchorId = new Map<string, NormalizedCallsiteItem>();
    for (const candidate of candidates) {
        const item = buildSemanticFlowRuleCandidateItem(candidate, { maxContextSlices: 1 });
        candidateByAnchorId.set(item.anchor.id, candidate);
    }
    const companionGroups = buildRuleCandidateCompanionGroups(candidates);
    return {
        async expand(input) {
            const raw = candidateByAnchorId.get(input.anchor.id);
            if (!raw) {
                return {
                    slice: input.slice,
                    delta: createSemanticFlowDelta(input.anchor, input.round + 1, input.deficit, {}),
                };
            }
            const requestKind = input.deficit.kind;
            const contextSlices = Array.isArray((raw as any).contextSlices) ? (raw as any).contextSlices : [];
            const currentVisible = input.slice.snippets.filter(snippet => snippet.label.startsWith("callsite-")).length;
            const additions: typeof input.slice.snippets = [];
            const nextVisible = currentVisible < contextSlices.length ? currentVisible + 1 : currentVisible;
            if (nextVisible > currentVisible) {
                const rebuilt = buildSemanticFlowRuleCandidateItem(raw, { maxContextSlices: nextVisible });
                for (const snippet of rebuilt.initialSlice.snippets) {
                    if (!input.slice.snippets.some(existing => existing.label === snippet.label)) {
                        additions.push(snippet);
                    }
                }
            }
            const focusSnippet = buildFocusedSnippet(
                requestKind,
                raw,
                Math.max(0, nextVisible - 1),
                input.slice.snippets,
            );
            if (focusSnippet) {
                additions.push(focusSnippet);
            }
            const companionSnippets = buildCompanionSnippets(
                raw ? companionGroups.get(semanticFlowRuleCandidateKey(raw)) || [] : [],
                input.slice.snippets,
                requestKind,
            );
            additions.push(...companionSnippets);
            const ownerFamilySnippets = buildOwnerFamilyCompanionSnippets(raw, input.slice.snippets, requestKind);
            additions.push(...ownerFamilySnippets);
            const ownerSnippet = buildRuleOwnerSnippet(raw, input.slice.snippets, requestKind);
            if (ownerSnippet) {
                additions.push(ownerSnippet);
            }
            if (additions.length === 0) {
                return {
                    slice: input.slice,
                    delta: createSemanticFlowDelta(input.anchor, input.round + 1, input.deficit, {}),
                };
            }
            const newObservations = [
                ...(nextVisible > currentVisible ? [`expanded_context_slices=${nextVisible}`] : []),
                ...(focusSnippet ? [`expanded_focus=${requestKind}`] : []),
                ...(companionSnippets.length > 0 ? [`expanded_companions=${companionSnippets.length}`] : []),
                ...(ownerFamilySnippets.length > 0 ? [`expanded_owner_family=${ownerFamilySnippets.length}`] : []),
                ...(ownerSnippet ? ["expanded_owner_context=true"] : []),
            ];
            const newCompanions = [
                ...companionSnippets.map(snippet => snippet.label.replace(/^companion-/, "").replace(/-\d+$/, "")),
                ...ownerFamilySnippets.map(snippet => snippet.label.replace(/^owner-sibling-/, "").replace(/-\d+$/, "")),
            ];
            const delta = createSemanticFlowDelta(input.anchor, input.round + 1, input.deficit, {
                observations: newObservations,
                snippets: additions,
                companions: newCompanions,
            });
            return {
                slice: {
                    ...input.slice,
                    round: input.round + 1,
                    observations: [...input.slice.observations, ...delta.newObservations],
                    template: companionSnippets.length > 0 || ownerFamilySnippets.length > 0
                        ? "multi-surface"
                        : (requestKind === "q_cb" || requestKind === "q_wrap" ? "callable-transfer" : input.slice.template),
                    companions: companionSnippets.length > 0 || ownerFamilySnippets.length > 0
                        ? dedupeStrings([
                            ...(input.slice.companions || []),
                            ...delta.newCompanions,
                        ])
                        : input.slice.companions,
                    snippets: [...input.slice.snippets, ...delta.newSnippets],
                    notes: [...(input.slice.notes || []), input.deficit.ask],
                },
                delta,
            };
        },
    };
}

export function createArkMainCandidateExpander(
    candidates: ArkMainEntryCandidate[],
): SemanticFlowExpander {
    const candidateByAnchorId = new Map<string, ArkMainEntryCandidate>();
    for (const candidate of candidates) {
        const item = buildSemanticFlowArkMainCandidateItem(candidate);
        candidateByAnchorId.set(item.anchor.id, candidate);
    }
    return {
        async expand(input) {
            const candidate = candidateByAnchorId.get(input.anchor.id);
            if (!candidate) {
                return {
                    slice: input.slice,
                    delta: createSemanticFlowDelta(input.anchor, input.round + 1, input.deficit, {}),
                };
            }
            const existingLabels = new Set(input.slice.snippets.map(snippet => snippet.label));
            const bodySnippet = buildMethodBodySnippet(candidate);
            const ownerSnippet = buildOwnerSnippet(candidate);
            const ownerMethodsSnippet = buildOwnerMethodsSnippet(candidate);
            const additions = [
                bodySnippet && !existingLabels.has("method-body")
                    ? { label: "method-body", code: bodySnippet }
                    : undefined,
                ownerSnippet && !existingLabels.has("owner-context")
                    ? { label: "owner-context", code: ownerSnippet }
                    : undefined,
                ownerMethodsSnippet && !existingLabels.has("owner-methods")
                    ? { label: "owner-methods", code: ownerMethodsSnippet }
                    : undefined,
            ].filter(Boolean) as Array<{ label: string; code: string }>;
            if (additions.length === 0) {
                return {
                    slice: input.slice,
                    delta: createSemanticFlowDelta(input.anchor, input.round + 1, input.deficit, {}),
                };
            }
            const delta = createSemanticFlowDelta(input.anchor, input.round + 1, input.deficit, {
                observations: [
                    "expanded: method body evidence",
                    "expanded: owner context evidence",
                ],
                snippets: additions,
            });
            return {
                slice: {
                    ...input.slice,
                    round: input.round + 1,
                    observations: [...input.slice.observations, ...delta.newObservations],
                    snippets: [...input.slice.snippets, ...delta.newSnippets],
                    notes: [...(input.slice.notes || []), input.deficit.ask],
                },
                delta,
            };
        },
    };
}

export function createCompositeSemanticFlowExpander(
    expanders: SemanticFlowExpander[],
): SemanticFlowExpander {
    return {
        async expand(input) {
            for (const expander of expanders) {
                const expanded = await expander.expand(input);
                if (expanded.delta.effective) {
                    return expanded;
                }
            }
            return {
                slice: input.slice,
                delta: createSemanticFlowDelta(input.anchor, input.round + 1, input.deficit, {}),
            };
        },
    };
}

function buildMethodBodySnippet(candidate: ArkMainEntryCandidate): string | undefined {
    const cfg = candidate.method.getCfg?.();
    const stmts = cfg?.getStmts?.() || [];
    if (stmts.length === 0) {
        return undefined;
    }
    return stmts
        .slice(0, 16)
        .map((stmt: any, index: number) => {
            const text = typeof stmt?.getOriginalText === "function"
                ? stmt.getOriginalText()
                : stmt?.toString?.() || "<stmt>";
            return `${index + 1}. ${String(text)}`;
        })
        .join("\n");
}

function buildOwnerSnippet(candidate: ArkMainEntryCandidate): string {
    return [
        `class=${candidate.className}`,
        `superClass=${candidate.superClassName || "-"}`,
        `filePath=${candidate.filePath || "-"}`,
        `isOverride=${candidate.isOverride}`,
        `parameterTypes=${candidate.parameterTypes.join(",") || "-"}`,
        `returnType=${candidate.returnType || "-"}`,
    ].join("\n");
}

function buildOwnerMethodsSnippet(candidate: ArkMainEntryCandidate): string | undefined {
    const siblings = candidate.method.getDeclaringArkClass?.()?.getMethods?.() || [];
    const siblingHeaders = siblings
        .filter(method => !method.isGenerated?.() && !method.isAnonymousMethod?.())
        .slice(0, 12)
        .map(method => {
            const signature = method.getSignature?.()?.toString?.() || method.getName?.() || "<method>";
            return `- ${signature}`;
        });
    if (siblingHeaders.length === 0) {
        return undefined;
    }
    return [
        "ownerMethods:",
        ...siblingHeaders,
    ].join("\n");
}

function buildCompanionSnippets(
    companions: NormalizedCallsiteItem[],
    existingSnippets: Array<{ label: string }>,
    requestKind: "q_ret" | "q_recv" | "q_cb" | "q_comp" | "q_meta" | "q_wrap",
): Array<{ label: string; code: string }> {
    const existingLabels = new Set(existingSnippets.map(snippet => snippet.label));
    const out: Array<{ label: string; code: string }> = [];
    for (const companion of selectCompanionsForRequest(companions, requestKind)) {
        const label = nextCompanionLabel(companion, existingLabels, out);
        if (existingLabels.has(label)) {
            continue;
        }
        const context = firstContextSlice(companion);
        out.push({
            label,
            code: [
                `callee_signature: ${companion.callee_signature}`,
                `method: ${companion.method}`,
                `invokeKind: ${companion.invokeKind}`,
                `argCount: ${companion.argCount}`,
                `sourceFile: ${companion.sourceFile}`,
                ...(context ? [
                    "",
                    `callerFile: ${context.callerFile}`,
                    `callerMethod: ${context.callerMethod || "-"}`,
                    `invokeLine: ${context.invokeLine}`,
                    `invokeStmt: ${context.invokeStmtText}`,
                    "",
                    context.windowLines,
                ] : []),
            ].join("\n"),
        });
    }
    return out;
}

function buildRuleOwnerSnippet(
    raw: NormalizedCallsiteItem,
    existingSnippets: Array<{ label: string }>,
    requestKind: "q_ret" | "q_recv" | "q_cb" | "q_comp" | "q_meta" | "q_wrap",
): { label: string; code: string } | undefined {
    if (requestKind !== "q_comp" && requestKind !== "q_wrap") {
        return undefined;
    }
    if (existingSnippets.some(snippet => snippet.label === "owner-context")) {
        return undefined;
    }
    const ownerSnippet = typeof (raw as any).ownerSnippet === "string"
        ? String((raw as any).ownerSnippet).trim()
        : "";
    if (!ownerSnippet) {
        return undefined;
    }
    return {
        label: "owner-context",
        code: ownerSnippet,
    };
}

function buildOwnerFamilyCompanionSnippets(
    raw: NormalizedCallsiteItem,
    existingSnippets: Array<{ label: string }>,
    requestKind: "q_ret" | "q_recv" | "q_cb" | "q_comp" | "q_meta" | "q_wrap",
): Array<{ label: string; code: string }> {
    if (requestKind !== "q_comp" && requestKind !== "q_wrap") {
        return [];
    }
    const ownerMethods = Array.isArray((raw as any).ownerMethodSnippets)
        ? (raw as any).ownerMethodSnippets as Array<{ method?: string; code?: string }>
        : [];
    const existingLabels = new Set(existingSnippets.map(snippet => snippet.label));
    const out: Array<{ label: string; code: string }> = [];
    for (const method of ownerMethods.slice(0, requestKind === "q_wrap" ? 1 : 3)) {
        const methodName = String(method.method || "").trim();
        const code = String(method.code || "").trim();
        const label = `owner-sibling-${methodName}`;
        if (!methodName || !code || existingLabels.has(label)) {
            continue;
        }
        out.push({ label, code });
    }
    return out;
}

function buildFocusedSnippet(
    requestKind: "q_ret" | "q_recv" | "q_cb" | "q_comp" | "q_meta" | "q_wrap",
    raw: NormalizedCallsiteItem,
    targetIndex: number,
    existingSnippets: Array<{ label: string }>,
): { label: string; code: string } | undefined {
    if (requestKind === "q_comp") {
        return undefined;
    }
    const contextSlices = Array.isArray((raw as any).contextSlices) ? (raw as any).contextSlices : [];
    if (contextSlices.length === 0) {
        return undefined;
    }
    const slice = contextSlices[Math.max(0, Math.min(targetIndex, contextSlices.length - 1))];
    if (!slice) {
        return undefined;
    }
    const label = `focus-${requestKind.replace(/^q_/, "")}-${Math.max(0, Math.min(targetIndex, contextSlices.length - 1))}`;
    if (existingSnippets.some(snippet => snippet.label === label)) {
        return undefined;
    }
    const focusLines = selectFocusLines(requestKind, slice);
    return {
        label,
        code: [
            `focus: ${requestKind}`,
            `callerFile: ${slice.callerFile}`,
            `callerMethod: ${slice.callerMethod || "-"}`,
            `invokeLine: ${slice.invokeLine}`,
            `invokeStmt: ${slice.invokeStmtText}`,
            "",
            ...focusLines,
        ].join("\n"),
    };
}

function selectCompanionsForRequest(
    companions: NormalizedCallsiteItem[],
    requestKind: "q_ret" | "q_recv" | "q_cb" | "q_comp" | "q_meta" | "q_wrap",
): NormalizedCallsiteItem[] {
    const filtered = companions.filter(companion => {
        if (requestKind === "q_cb") return isCallbackLike(companion);
        if (requestKind === "q_meta") return isMetaLike(companion);
        if (requestKind === "q_recv") return isReceiverLike(companion);
        return true;
    });
    const selected = filtered.length > 0 ? filtered : (requestKind === "q_comp" || requestKind === "q_wrap" ? companions : []);
    const limit = requestKind === "q_wrap" ? 1 : 3;
    return selected.slice(0, limit);
}

function selectFocusLines(
    requestKind: "q_ret" | "q_recv" | "q_cb" | "q_comp" | "q_meta" | "q_wrap",
    slice: { invokeStmtText: string; cfgNeighborStmts?: string[]; windowLines: string },
): string[] {
    const patterns: Record<string, RegExp> = {
        q_ret: /\breturn\b|=/i,
        q_recv: /\bthis\b|field|slot|store|load|save|set|get/i,
        q_cb: /callback|cb|listener|bind|emit|publish|subscribe|then|catch|promise|=>/i,
        q_meta: /@|decorator|state|prop|link|provide|consume/i,
        q_wrap: /return|forward|delegate|helper|wrap|invoke/i,
    };
    const cfg = Array.isArray(slice.cfgNeighborStmts) ? slice.cfgNeighborStmts : [];
    const pattern = patterns[requestKind];
    const matchedCfg = pattern ? cfg.filter(line => pattern.test(line)) : [];
    if (matchedCfg.length > 0) {
        return ["cfgNeighbors:", ...matchedCfg];
    }
    const matchedWindow = String(slice.windowLines || "")
        .split(/\r?\n/)
        .filter(line => pattern ? pattern.test(line) : false);
    if (matchedWindow.length > 0) {
        return ["window:", ...matchedWindow];
    }
    return cfg.length > 0
        ? ["cfgNeighbors:", ...cfg]
        : ["window:", String(slice.windowLines || slice.invokeStmtText)];
}

function isCallbackLike(candidate: NormalizedCallsiteItem): boolean {
    return hasSemanticToken(candidate, [
        "callback",
        "cb",
        "listener",
        "bind",
        "on",
        "emit",
        "publish",
        "subscribe",
        "then",
        "catch",
        "promise",
    ]);
}

function isMetaLike(candidate: NormalizedCallsiteItem): boolean {
    return hasSemanticToken(candidate, [
        "@",
        "decorator",
        "state",
        "prop",
        "link",
        "provide",
        "consume",
    ]);
}

function isReceiverLike(candidate: NormalizedCallsiteItem): boolean {
    return candidate.invokeKind === "instance" || hasSemanticToken(candidate, [
        "field",
        "store",
        "load",
        "save",
        "set",
        "get",
        "update",
        "assign",
    ]);
}

function hasSemanticToken(candidate: NormalizedCallsiteItem, tokens: string[]): boolean {
    const haystacks = [
        candidate.method,
        candidate.callee_signature,
        candidate.sourceFile,
        ...(Array.isArray((candidate as any).contextSlices)
            ? (candidate as any).contextSlices.flatMap((slice: any) => [
                slice?.invokeStmtText || "",
                slice?.windowLines || "",
                ...((slice?.cfgNeighborStmts || []) as string[]),
            ])
            : []),
    ].map(item => String(item || "").toLowerCase());
    return tokens.some(token => haystacks.some(text => text.includes(token.toLowerCase())));
}

function firstContextSlice(candidate: NormalizedCallsiteItem): {
    callerFile: string;
    callerMethod?: string;
    invokeLine: number;
    invokeStmtText: string;
    windowLines: string;
} | undefined {
    const contextSlices = Array.isArray((candidate as any).contextSlices) ? (candidate as any).contextSlices : [];
    return contextSlices[0];
}

function nextCompanionLabel(
    companion: NormalizedCallsiteItem,
    existingLabels: Set<string>,
    pending: Array<{ label: string }>,
): string {
    const base = `companion-${companion.method || "surface"}`;
    let label = base;
    let index = 1;
    while (existingLabels.has(label) || pending.some(item => item.label === label)) {
        label = `${base}-${index++}`;
    }
    return label;
}

function dedupeStrings(values: string[]): string[] {
    return [...new Set(values.filter(Boolean))];
}
