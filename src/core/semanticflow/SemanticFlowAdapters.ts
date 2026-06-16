import type { ArkMainEntryCandidate } from "../entry/arkmain/llm/ArkMainEntryCandidateTypes";
import type { CallsiteContextSlice, NormalizedCallsiteItem } from "../model/callsite/callsiteContextSlices";
import type { SemanticFlowPipelineItemInput } from "./SemanticFlowPipeline";
import { semanticFlowDeclaringClassFromSignature } from "./SemanticFlowRuleCompanions";
import type {
    SemanticFlowAnchor,
    SemanticFlowArkMainSelector,
    SemanticFlowSliceCodeSnippet,
    SemanticFlowSlicePackage,
} from "./SemanticFlowTypes";

export interface SemanticFlowApiModelingCandidateAdapterOptions {
    maxContextSlices?: number;
    companionCandidates?: NormalizedCallsiteItem[];
}

export function buildSemanticFlowApiModelingCandidateItem(
    item: NormalizedCallsiteItem,
    options: SemanticFlowApiModelingCandidateAdapterOptions = {},
): SemanticFlowPipelineItemInput {
    const semanticFocus = normalizeSemanticFocus(item);
    const anchorId = sanitizeKey([
        "api-modeling",
        item.callee_signature,
        item.sourceFile,
        String(item.argCount),
        item.invokeKind,
        semanticFocus,
    ].join("."));

    const companions = buildRuleCompanionNames(options.companionCandidates);
    const callbackProperties = normalizeStringList((item as any).callbackProperties);
    const callbackArgIndexes = normalizeNumberList((item as any).callbackArgIndexes);
    const typeHint = normalizeTypeHint((item as any).typeHint);
    return {
        anchor: {
            id: anchorId,
            owner: semanticFlowDeclaringClassFromSignature(item.callee_signature),
            surface: item.method || "unknown",
            methodSignature: item.callee_signature,
            filePath: item.sourceFile,
            importSource: item.sourceFile,
            callbackProperties,
            callbackArgIndexes,
            typeHint,
            arkMainSelector: buildApiModelingArkMainSelector(item),
            metaTags: [
                "api-modeling-candidate",
                item.invokeKind,
                ...(semanticFocus ? [`focus-${semanticFocus}`] : []),
            ],
        },
        initialSlice: {
            anchorId,
            round: 0,
            template: selectRuleTemplate(item, companions),
            observations: buildRuleObservations(item),
            snippets: buildRuleSnippets(item, options.maxContextSlices, options.companionCandidates),
            companions: buildRuleCompanionList(item, companions),
            notes: buildRuleNotes(item),
        },
    };
}

function buildApiModelingArkMainSelector(item: NormalizedCallsiteItem): SemanticFlowArkMainSelector | undefined {
    if (!hasCandidateBoundary(item, "official_arkmain_entry_evidence")) {
        return undefined;
    }
    const methodName = String(item.method || "").trim();
    if (!methodName) {
        return undefined;
    }
    const className = semanticFlowDeclaringClassFromSignature(item.callee_signature);
    return {
        methodName,
        parameterTypes: parseSignatureParameterTypes(item.callee_signature, item.argCount),
        returnType: typeof (item as any).returnType === "string"
            ? String((item as any).returnType).trim() || undefined
            : undefined,
        className,
    };
}

function hasCandidateBoundary(item: NormalizedCallsiteItem, boundary: string): boolean {
    const expected = `candidateBoundary=${boundary}`;
    return (item.topEntries || []).some(entry => String(entry || "").trim() === expected);
}

function parseSignatureParameterTypes(signature: string, defaultArgCount?: number): string[] {
    const text = String(signature || "");
    const start = text.lastIndexOf("(");
    const end = text.lastIndexOf(")");
    if (start >= 0 && end > start) {
        const body = text.slice(start + 1, end).trim();
        if (!body) {
            return [];
        }
        return splitTopLevelComma(body).map(part => part.trim() || "Unknown");
    }
    return Array.from({ length: Math.max(0, defaultArgCount || 0) }, () => "Unknown");
}

function normalizeStringList(values: unknown): string[] | undefined {
    if (!Array.isArray(values)) return undefined;
    const out = new Set<string>();
    for (const value of values) {
        const text = String(value || "").trim();
        if (text) out.add(text);
    }
    return out.size > 0 ? [...out.values()].sort((a, b) => a.localeCompare(b)) : undefined;
}

function normalizeNumberList(values: unknown): number[] | undefined {
    if (!Array.isArray(values)) return undefined;
    const out = new Set<number>();
    for (const value of values) {
        const num = Number(value);
        if (Number.isInteger(num) && num >= 0) out.add(num);
    }
    return out.size > 0 ? [...out.values()].sort((a, b) => a - b) : undefined;
}

function normalizeTypeHint(value: unknown): string | undefined {
    const text = String(value || "").trim();
    if (!/^[A-Za-z0-9_.:-]+$/.test(text)) {
        return undefined;
    }
    return text;
}

export function buildSemanticFlowArkMainCandidateItem(
    candidate: ArkMainEntryCandidate,
): SemanticFlowPipelineItemInput {
    const anchorId = sanitizeKey(`arkmain.${candidate.methodSignature}`);
    return {
        anchor: {
            id: anchorId,
            owner: candidate.className,
            surface: candidate.methodName,
            method: candidate.method,
            methodSignature: candidate.methodSignature,
            filePath: candidate.filePath,
            arkMainSelector: buildArkMainSelector(candidate),
            metaTags: [
                "arkmain",
                "candidate",
                ...(candidate.ownerSignals.length > 0 ? ["owner-signal"] : []),
                ...(candidate.overrideSignals.length > 0 ? ["override-signal"] : []),
                ...(candidate.frameworkSignals.length > 0 ? ["framework-signal"] : []),
            ],
        },
        initialSlice: {
            anchorId,
            round: 0,
            template: "owner-slot",
            observations: buildArkMainObservations(candidate),
            snippets: buildArkMainSnippets(candidate),
        },
    };
}

function buildArkMainSelector(candidate: ArkMainEntryCandidate): SemanticFlowArkMainSelector {
    return {
        methodName: candidate.methodName,
        parameterTypes: [...candidate.parameterTypes],
        returnType: candidate.returnType,
        className: candidate.className || undefined,
        superClassName: candidate.superClassName,
        requireOverride: candidate.isOverride,
    };
}

function buildArkMainObservations(candidate: ArkMainEntryCandidate): string[] {
    return [
        `signature=${candidate.methodSignature}`,
        `class=${candidate.className || "-"}`,
        `superClass=${candidate.superClassName || "-"}`,
        `filePath=${candidate.filePath || "-"}`,
        `isOverride=${candidate.isOverride}`,
        `parameterCount=${candidate.parameterTypes.length}`,
        `parameterTypes=${candidate.parameterTypes.join(",") || "-"}`,
        `returnType=${candidate.returnType || "-"}`,
    ];
}

function buildArkMainSnippets(candidate: ArkMainEntryCandidate): SemanticFlowSliceCodeSnippet[] {
    const snippets: SemanticFlowSliceCodeSnippet[] = [];
    const methodSnippet = buildArkMainMethodSnippet(candidate);
    if (methodSnippet) {
        snippets.push({
            label: "method",
            code: methodSnippet,
        });
    }
    const ownerSnippet = buildArkMainOwnerContextSnippet(candidate);
    if (ownerSnippet) {
        snippets.push({
            label: "owner-context",
            code: ownerSnippet,
        });
    }
    if (snippets.length === 0) {
        snippets.push({
            label: "candidate",
            code: [
                `signature: ${candidate.methodSignature}`,
                `class: ${candidate.className || "-"}`,
                `method: ${candidate.methodName || "-"}`,
            ].join("\n"),
        });
    }
    return snippets;
}

function buildArkMainMethodSnippet(candidate: ArkMainEntryCandidate): string | undefined {
    const code = String(candidate.method.getCode?.() || "").trim();
    if (code) {
        return code;
    }
    const cfg = candidate.method.getCfg?.();
    const stmts = cfg?.getStmts?.() || [];
    if (!stmts.length) {
        return undefined;
    }
    return stmts
        .slice(0, 12)
        .map((stmt: any, index: number) => {
            const text = typeof stmt?.getOriginalText === "function"
                ? stmt.getOriginalText()
                : stmt?.toString?.() || "<stmt>";
            return `${index + 1}. ${String(text)}`;
        })
        .join("\n");
}

function buildArkMainOwnerContextSnippet(candidate: ArkMainEntryCandidate): string {
    return [
        `class=${candidate.className || "-"}`,
        `superClass=${candidate.superClassName || "-"}`,
        `filePath=${candidate.filePath || "-"}`,
        `isOverride=${candidate.isOverride}`,
        `parameterTypes=${candidate.parameterTypes.join(",") || "-"}`,
        `returnType=${candidate.returnType || "-"}`,
    ].join("\n");
}

function buildRuleObservations(item: NormalizedCallsiteItem): string[] {
    const observations = [
        `signature=${item.callee_signature}`,
        `method=${item.method}`,
        `invokeKind=${item.invokeKind}`,
        `argCount=${item.argCount}`,
        `sourceFile=${item.sourceFile}`,
    ];
    if (typeof (item as any).returnType === "string" && (item as any).returnType.trim()) {
        observations.push(`returnType=${String((item as any).returnType).trim()}`);
    }
    const contextSlices = Array.isArray((item as any).contextSlices) ? (item as any).contextSlices as CallsiteContextSlice[] : [];
    if (contextSlices.length > 0) {
        observations.push(`contextSlices=${contextSlices.length}`);
    }
    if (typeof (item as any).methodSnippet === "string" && (item as any).methodSnippet.trim()) {
        observations.push("methodSnippet=available");
        observations.push(...buildFormalParameterObservations(String((item as any).methodSnippet)));
    }
    const methodSnippetSource = typeof (item as any).methodSnippetSource === "string"
        ? String((item as any).methodSnippetSource).trim()
        : "";
    if (methodSnippetSource) {
        observations.push(`methodSnippetSource=${methodSnippetSource}`);
    }
    const ownerMethodSnippets = Array.isArray((item as any).ownerMethodSnippets)
        ? (item as any).ownerMethodSnippets as Array<{ method?: string }>
        : [];
    if (ownerMethodSnippets.length > 0) {
        observations.push(`ownerMethodSnippets=${ownerMethodSnippets.length}`);
    }
    const carrierRoots = Array.isArray((item as any).carrierRoots)
        ? ((item as any).carrierRoots as string[]).map(root => String(root || "").trim()).filter(Boolean)
        : [];
    if (carrierRoots.length > 0) {
        observations.push(`carrierRoots=${carrierRoots.length}`);
        for (const root of carrierRoots.slice(0, 3)) {
            observations.push(`carrierRoot=${root}`);
        }
    }
    const carrierObservations = Array.isArray((item as any).carrierObservations)
        ? ((item as any).carrierObservations as string[]).map(entry => String(entry || "").trim()).filter(Boolean)
        : [];
    observations.push(...carrierObservations);
    const carrierMethodSnippets = Array.isArray((item as any).carrierMethodSnippets)
        ? (item as any).carrierMethodSnippets as Array<{ method?: string }>
        : [];
    if (carrierMethodSnippets.length > 0) {
        observations.push(`carrierMethodSnippets=${carrierMethodSnippets.length}`);
    }
    if (typeof item.count === "number") {
        observations.push(`count=${item.count}`);
    }
    const semanticFocus = normalizeSemanticFocus(item);
    if (semanticFocus) {
        observations.push(`semanticFocus=${semanticFocus}`);
    }
    observations.push(...buildBridgeEvidenceObservations(item));
    const candidateOrigin = typeof (item as any).candidateOrigin === "string"
        ? String((item as any).candidateOrigin).trim()
        : "";
    if (candidateOrigin) {
        observations.push(`candidateOrigin=${candidateOrigin}`);
    }
    const callbackProperties = Array.isArray((item as any).callbackProperties)
        ? ((item as any).callbackProperties as unknown[]).map(value => String(value || "").trim()).filter(Boolean)
        : [];
    if (callbackProperties.length > 0) {
        observations.push(`callbackProperties=${callbackProperties.join(",")}`);
    }
    const callbackArgIndexes = Array.isArray((item as any).callbackArgIndexes)
        ? ((item as any).callbackArgIndexes as unknown[]).map(value => Number(value)).filter(value => Number.isInteger(value) && value >= 0)
        : [];
    if (callbackArgIndexes.length > 0) {
        observations.push(`callbackArgIndexes=${[...new Set(callbackArgIndexes)].sort((a, b) => a - b).join(",")}`);
    }
    const typeHint = normalizeTypeHint((item as any).typeHint);
    if (typeHint) {
        observations.push(`typeHint=${typeHint}`);
    }
    const importSource = typeof (item as any).importSource === "string"
        ? String((item as any).importSource).trim()
        : "";
    if (importSource) {
        observations.push(`importSource=${importSource}`);
    }
    for (const entry of item.topEntries || []) {
        observations.push(`topEntry=${entry}`);
    }
    return observations;
}

function buildRuleSnippets(
    item: NormalizedCallsiteItem,
    maxContextSlices?: number,
    companionCandidates?: NormalizedCallsiteItem[],
): SemanticFlowSliceCodeSnippet[] {
    const snippets: SemanticFlowSliceCodeSnippet[] = [];
    const contextSlices = Array.isArray((item as any).contextSlices) ? (item as any).contextSlices as CallsiteContextSlice[] : [];
    const visibleSlices = typeof maxContextSlices === "number"
        ? contextSlices.slice(0, Math.max(0, maxContextSlices))
        : contextSlices;
    const methodSnippet = typeof (item as any).methodSnippet === "string"
        ? String((item as any).methodSnippet).trim()
        : "";
    const skipRedundantBridgeCallsite = isBridgeCandidate(item) && !!methodSnippet;

    if (!skipRedundantBridgeCallsite) {
        for (const [index, slice] of visibleSlices.entries()) {
            const cfgNeighborStmts = compactSnippetLines(slice.cfgNeighborStmts || [], {
                dropExact: [slice.invokeStmtText],
                maxLines: 8,
            });
            snippets.push({
                label: `callsite-${index}`,
                code: [
                    `callerFile: ${slice.callerFile}`,
                    `callerMethod: ${slice.callerMethod || "-"}`,
                    `invokeLine: ${slice.invokeLine}`,
                    `invokeStmt: ${slice.invokeStmtText}`,
                    "",
                    compactSnippetText(slice.windowLines, { maxLines: 16 }),
                    ...(cfgNeighborStmts.length
                        ? ["", "cfgNeighbors:", ...cfgNeighborStmts]
                        : []),
                ].join("\n"),
            });
        }
    }

    if (methodSnippet && shouldIncludeMethodSnippet(item)) {
        snippets.push({
            label: isBridgeCandidate(item) ? "method-bridge-evidence" : "method",
            code: isBridgeCandidate(item) ? compactBridgeSnippet(methodSnippet) : compactMethodEvidenceSnippet(methodSnippet),
        });
    }

    const ownerSnippet = typeof (item as any).ownerSnippet === "string"
        ? String((item as any).ownerSnippet).trim()
        : "";
    const ownerMethodSnippets = Array.isArray((item as any).ownerMethodSnippets)
        ? (item as any).ownerMethodSnippets as Array<{ method?: string; code?: string }>
        : [];
    if (shouldInlineOwnerFamily(item) && ownerSnippet) {
        snippets.push({
            label: "owner-context",
            code: ownerSnippet,
        });
    }
    if (shouldInlineOwnerFamily(item)) {
        for (const companion of ownerMethodSnippets.slice(0, 1)) {
            const methodName = String(companion.method || "").trim();
            const code = String(companion.code || "").trim();
            if (!methodName || !code) {
                continue;
            }
            snippets.push({
                label: `owner-sibling-${methodName}`,
                code,
            });
        }
    }

    const carrierSnippet = typeof (item as any).carrierSnippet === "string"
        ? String((item as any).carrierSnippet).trim()
        : "";
    const carrierMethodSnippets = Array.isArray((item as any).carrierMethodSnippets)
        ? (item as any).carrierMethodSnippets as Array<{ method?: string; code?: string }>
        : [];
    if (shouldInlineCarrierEvidence(item) && carrierSnippet) {
        snippets.push({
            label: "carrier-context",
            code: carrierSnippet,
        });
    }
    if (shouldInlineCarrierEvidence(item)) {
        for (const companion of carrierMethodSnippets.slice(0, 2)) {
            const methodName = String(companion.method || "").trim();
            const code = String(companion.code || "").trim();
            if (!methodName || !code) {
                continue;
            }
            snippets.push({
                label: `carrier-sibling-${methodName}`,
                code,
            });
        }
    }

    if (snippets.length === 0) {
        snippets.push({
            label: "candidate",
            code: [
                `callee_signature: ${item.callee_signature}`,
                `method: ${item.method}`,
                `invokeKind: ${item.invokeKind}`,
                `argCount: ${item.argCount}`,
            ].join("\n"),
        });
    }

    const visibleCompanions = isBridgeCandidate(item)
        ? selectBridgeCompanionCandidates(item, companionCandidates || [])
        : selectRuleCompanionCandidates(item, companionCandidates || []);
    for (const companion of visibleCompanions) {
        const companionSnippet = typeof (companion as any).methodSnippet === "string"
            ? String((companion as any).methodSnippet).trim()
            : "";
        const inlineCompanionEvidence = shouldInlineCompanionMethodEvidence(item, companion)
            || shouldInlineTransitiveCompanionMethodEvidence(item, companion, visibleCompanions);
        snippets.push({
            label: isBridgeCandidate(item)
                ? `bridge-companion-${companion.method || "surface"}`
                : `companion-${companion.method || "surface"}`,
            code: companionSnippet && isBridgeCandidate(item)
                ? [
                    `callee_signature: ${companion.callee_signature}`,
                    `method: ${companion.method}`,
                    `invokeKind: ${companion.invokeKind}`,
                    `argCount: ${companion.argCount}`,
                    `sourceFile: ${companion.sourceFile}`,
                    "",
                    compactBridgeSnippet(companionSnippet),
                ].join("\n")
                : companionSnippet && inlineCompanionEvidence
                    ? [
                        `callee_signature: ${companion.callee_signature}`,
                        `method: ${companion.method}`,
                        `invokeKind: ${companion.invokeKind}`,
                        `argCount: ${companion.argCount}`,
                        `sourceFile: ${companion.sourceFile}`,
                        ...buildCompanionFinalSinkUsageLines(companion),
                        "",
                        compactMethodEvidenceSnippet(companionSnippet),
                    ].join("\n")
                : [
                    `callee_signature: ${companion.callee_signature}`,
                    `method: ${companion.method}`,
                    `invokeKind: ${companion.invokeKind}`,
                    `argCount: ${companion.argCount}`,
                    `sourceFile: ${companion.sourceFile}`,
                ].join("\n"),
        });
    }

    return snippets;
}

function selectRuleCompanionCandidates(item: NormalizedCallsiteItem, companionCandidates: NormalizedCallsiteItem[]): NormalizedCallsiteItem[] {
    const selected: NormalizedCallsiteItem[] = [];
    const seen = new Set<string>();
    const add = (candidate: NormalizedCallsiteItem): void => {
        const key = [
            normalizeSlashes(String(candidate.sourceFile || "")),
            String(candidate.owner || ""),
            String(candidate.method || ""),
            String(candidate.callee_signature || ""),
        ].join("\u0000");
    const selfKey = [
        normalizeSlashes(String(item.sourceFile || "")),
        String(item.owner || ""),
        String(item.method || ""),
        String(item.callee_signature || ""),
        ].join("\u0000");
        if (key === selfKey || seen.has(key)) {
            return;
        }
        seen.add(key);
        selected.push(candidate);
    };

    for (const candidate of selectEventBusDispatchCompanionCandidates(item, companionCandidates)) {
        add(candidate);
    }
    for (const candidate of companionCandidates) {
        if (shouldInlineCompanionMethodEvidence(item, candidate)) {
            add(candidate);
        }
    }
    for (const candidate of [...selected]) {
        for (const transitive of companionCandidates) {
            if (shouldInlineCompanionMethodEvidence(candidate, transitive)) {
                add(transitive);
            }
        }
    }
    for (const candidate of companionCandidates) {
        if (selected.length >= 4) {
            break;
        }
        add(candidate);
    }
    return selected.slice(0, 4);
}

function selectEventBusDispatchCompanionCandidates(
    item: NormalizedCallsiteItem,
    companionCandidates: NormalizedCallsiteItem[],
): NormalizedCallsiteItem[] {
    if (!isEventCallbackModelingItem(item)) {
        return [];
    }
    const itemFile = normalizeSlashes(String(item.sourceFile || ""));
    return companionCandidates
        .filter(candidate => normalizeSlashes(String(candidate.sourceFile || "")) === itemFile)
        .filter(isProjectEventBusDispatchCompanion)
        .sort((left, right) => eventBusDispatchPriority(left) - eventBusDispatchPriority(right))
        .slice(0, 2);
}

function isEventCallbackModelingItem(item: NormalizedCallsiteItem): boolean {
    const topEntries = Array.isArray(item.topEntries)
        ? item.topEntries.map(entry => String(entry || "").trim())
        : [];
    const callbackArgIndexes = Array.isArray((item as any).callbackArgIndexes)
        ? (item as any).callbackArgIndexes
        : [];
    return String((item as any).candidateOrigin || "") === "recall_method_callback_surface"
        && callbackArgIndexes.length > 0
        && (topEntries.some(entry => entry === "typeHint=event") || String((item as any).typeHint || "") === "event");
}

function isProjectEventBusDispatchCompanion(candidate: NormalizedCallsiteItem): boolean {
    const topEntries = Array.isArray(candidate.topEntries)
        ? candidate.topEntries.map(entry => String(entry || "").trim())
        : [];
    if (!topEntries.some(entry => entry === "candidateBoundary=project_event_bus_wrapper_evidence")) {
        return false;
    }
    const method = String(candidate.method || "").trim().toLowerCase();
    return /^(sendevent|send|emit|publish|trigger|dispatch|post|fire|notify)$/.test(method)
        || /(?:event|emit|publish|dispatch|notify)/.test(method);
}

function eventBusDispatchPriority(candidate: NormalizedCallsiteItem): number {
    const method = String(candidate.method || "").trim().toLowerCase();
    if (method === "sendevent") return 0;
    if (/event/.test(method)) return 1;
    if (/^(emit|publish|dispatch|trigger|fire|notify)$/.test(method)) return 2;
    return 3;
}

function shouldInlineTransitiveCompanionMethodEvidence(
    item: NormalizedCallsiteItem,
    companion: NormalizedCallsiteItem,
    visibleCompanions: NormalizedCallsiteItem[],
): boolean {
    return visibleCompanions.some(candidate =>
        candidate !== companion
        && shouldInlineCompanionMethodEvidence(item, candidate)
        && shouldInlineCompanionMethodEvidence(candidate, companion));
}

function buildCompanionFinalSinkUsageLines(companion: NormalizedCallsiteItem): string[] {
    const methodSnippet = typeof (companion as any).methodSnippet === "string"
        ? String((companion as any).methodSnippet)
        : "";
    if (!methodSnippet) {
        return [];
    }
    const params = extractFormalParameters(methodSnippet);
    if (params.length === 0) {
        return [];
    }
    const visibleSinkArgs = collectVisibleOfficialSinkArguments(methodSnippet);
    if (visibleSinkArgs.length === 0) {
        return [];
    }

    const used: string[] = [];
    const unused: string[] = [];
    for (const param of params) {
        const pattern = new RegExp(`(?:\\.\\.\\.)?\\b${escapeRegExp(param.name)}\\b`);
        const target = `${param.slot}(${param.name})`;
        if (visibleSinkArgs.some(args => pattern.test(args))) {
            used.push(target);
        } else {
            unused.push(target);
        }
    }
    if (used.length === 0 && unused.length === 0) {
        return [];
    }
    return [
        `companionFinalSinkUsage=${companion.method || "surface"} used:${used.join(",") || "-"} unused:${unused.join(",") || "-"}`,
    ];
}

function buildFormalParameterObservations(methodSnippet: string): string[] {
    const params = extractFormalParameters(methodSnippet);
    if (params.length === 0) {
        return [];
    }
    const observations: string[] = [];
    const payloadSlots: string[] = [];
    const metadataSlots: string[] = [];
    for (const param of params.slice(0, 12)) {
        const semanticRole = classifyFormalParameterSemanticRole(param.name, param.type);
        observations.push([
            `formalParam=${param.slot}`,
            `name=${param.name}`,
            `type=${param.type || "Unknown"}`,
            `semanticRole=${semanticRole}`,
        ].join(";"));
        if (semanticRole === "payload" || semanticRole === "header-or-credential-payload") {
            payloadSlots.push(`${param.slot}(${param.name})`);
        }
        if (semanticRole === "control-metadata" || semanticRole === "destination-metadata") {
            metadataSlots.push(`${param.slot}(${param.name})`);
        }
    }
    if (payloadSlots.length || metadataSlots.length) {
        observations.push(`requestWrapperEndpointHint=payload:${payloadSlots.join(",") || "-"} metadata:${metadataSlots.join(",") || "-"}`);
    }
    return observations;
}

function extractFormalParameters(methodSnippet: string): Array<{ name: string; slot: string; type?: string }> {
    const signatureParams = extractSignatureParameterText(methodSnippet);
    if (!signatureParams) {
        return [];
    }
    const rawParams = splitTopLevelComma(signatureParams);
    const params: Array<{ name: string; slot: string; type?: string }> = [];
    for (const [index, raw] of rawParams.entries()) {
        const cleaned = raw
            .trim()
            .replace(/^(public|private|protected|readonly)\s+/, "")
            .replace(/\s*=\s*[\s\S]*$/, "")
            .trim();
        const nameMatch = cleaned.match(/^\s*(?:\.\.\.)?([A-Za-z_$][\w$]*)\??\b/);
        if (!nameMatch) {
            continue;
        }
        const colon = cleaned.indexOf(":");
        const type = colon >= 0 ? cleaned.slice(colon + 1).trim() : "";
        params.push({ name: nameMatch[1], slot: `arg${index}`, ...(type ? { type } : {}) });
    }
    return params;
}

function extractSignatureParameterText(methodSnippet: string): string {
    const normalized = String(methodSnippet || "")
        .split(/\r?\n/)
        .map(line => line.replace(/^\s*\d+\s*\|\s?/, ""))
        .join("\n");
    const open = normalized.indexOf("(");
    if (open < 0) {
        return "";
    }
    let depth = 0;
    for (let i = open; i < normalized.length; i++) {
        const char = normalized[i];
        if (char === "(") {
            depth++;
            continue;
        }
        if (char === ")") {
            depth--;
            if (depth === 0) {
                return normalized.slice(open + 1, i).trim();
            }
        }
    }
    return "";
}

function classifyFormalParameterSemanticRole(name: string, type?: string): string {
    const text = `${name} ${type || ""}`.toLowerCase();
    if (/\b(method|verb|operation|action|expect|binary|flag|mode|retry|timeout|options?)\b/.test(text)) {
        return "control-metadata";
    }
    if (/\b(path|uri|url|endpoint|host|baseurl|route|target)\b/.test(text)) {
        return "destination-metadata";
    }
    if (/\b(header|headers|auth|token|credential|password|secret|cookie|session)\b/.test(text)) {
        return "header-or-credential-payload";
    }
    if (/\b(body|payload|data|content|file|files|buffer|bytes|blob|form|params|query|requestbody)\b/.test(text)) {
        return "payload";
    }
    if (/\b(callback|handler|listener|success|fail|error)\b/.test(text)) {
        return "callback";
    }
    return "unknown";
}

function splitTopLevelComma(value: string): string[] {
    const parts: string[] = [];
    let current = "";
    let angleDepth = 0;
    let parenDepth = 0;
    let bracketDepth = 0;
    for (const char of value) {
        if (char === "<") angleDepth++;
        if (char === ">" && angleDepth > 0) angleDepth--;
        if (char === "(") parenDepth++;
        if (char === ")" && parenDepth > 0) parenDepth--;
        if (char === "[") bracketDepth++;
        if (char === "]" && bracketDepth > 0) bracketDepth--;
        if (char === "," && angleDepth === 0 && parenDepth === 0 && bracketDepth === 0) {
            parts.push(current);
            current = "";
            continue;
        }
        current += char;
    }
    if (current.trim()) {
        parts.push(current);
    }
    return parts;
}

function collectVisibleOfficialSinkArguments(methodSnippet: string): string[] {
    const out: string[] = [];
    const patterns = [
        /\bhilog\s*\.\s*[A-Za-z_$][\w$]*\s*\(([^)]*)\)/g,
        /\bconsole\s*\.\s*[A-Za-z_$][\w$]*\s*\(([^)]*)\)/g,
    ];
    for (const pattern of patterns) {
        for (const match of String(methodSnippet || "").matchAll(pattern)) {
            const args = String(match[1] || "").trim();
            if (args) {
                out.push(args);
            }
        }
    }
    return out;
}

function shouldInlineCompanionMethodEvidence(item: NormalizedCallsiteItem, companion: NormalizedCallsiteItem): boolean {
    const method = String(companion.method || "").trim();
    if (!method || !/^[A-Za-z_$][\w$]*$/.test(method)) {
        return false;
    }
    const methodSnippet = typeof (item as any).methodSnippet === "string"
        ? String((item as any).methodSnippet)
        : "";
    const callPattern = new RegExp(`(?:\\.|\\b)${escapeRegExp(method)}\\s*\\(`);
    if (!callPattern.test(methodSnippet)) {
        return false;
    }
    const itemFile = normalizeSlashes(String(item.sourceFile || ""));
    const companionFile = normalizeSlashes(String(companion.sourceFile || ""));
    return itemFile === companionFile || sameSourceDirectory(itemFile, companionFile);
}

function sameSourceDirectory(left: string, right: string): boolean {
    const leftDir = left.includes("/") ? left.slice(0, left.lastIndexOf("/")) : "";
    const rightDir = right.includes("/") ? right.slice(0, right.lastIndexOf("/")) : "";
    return !!leftDir && leftDir === rightDir;
}

function compactSnippetText(text: string, options: { maxLines: number }): string {
    const lines = compactSnippetLines(String(text || "").split(/\r?\n/), {
        maxLines: options.maxLines,
    });
    return lines.join("\n");
}

function compactMethodEvidenceSnippet(snippet: string): string {
    const lines = String(snippet || "").split(/\r?\n/);
    if (lines.length <= 46) {
        return snippet;
    }
    const keep = new Set<number>();
    for (let index = 0; index < Math.min(lines.length, 12); index++) {
        keep.add(index);
    }
    for (let index = Math.max(0, lines.length - 6); index < lines.length; index++) {
        keep.add(index);
    }
    const evidencePattern = /\b(?:return|await|hilog\s*\.|console\s*\.|realLog\s*\(|runJavaScript\s*\(|request\s*\(|fetch\s*\(|execute(?:Sql|DML|DQL)?\s*\(|query(?:Sql)?\s*\(|insert(?:Sync)?\s*\(|update\s*\(|write(?:Sync)?\s*\(|put(?:Sync)?\s*\(|get(?:Sync)?\s*\(|set(?:Credential|Object)?\s*\(|JSON\s*\.\s*(?:parse|stringify)\s*\(|callback|emit\s*\(|publish\s*\()\b/i;
    for (let index = 0; index < lines.length; index++) {
        if (!evidencePattern.test(lines[index])) {
            continue;
        }
        for (let offset = -2; offset <= 2; offset++) {
            const candidate = index + offset;
            if (candidate >= 0 && candidate < lines.length) {
                keep.add(candidate);
            }
        }
    }
    const ordered = [...keep.values()].sort((a, b) => a - b).slice(0, 54);
    if (ordered.length <= 0) {
        return compactSnippetLines(lines, { maxLines: 46 }).join("\n");
    }
    const out: string[] = [];
    let previous = -2;
    for (const index of ordered) {
        if (previous >= 0 && index > previous + 1) {
            out.push("    ...");
        }
        out.push(lines[index]);
        previous = index;
    }
    return out.join("\n");
}

function compactSnippetLines(
    lines: string[],
    options: {
        dropExact?: string[];
        maxLines: number;
    },
): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    const dropExact = new Set((options.dropExact || []).map(line => normalizeSnippetLine(line)));
    for (const line of lines) {
        const text = String(line || "").trimEnd();
        const normalized = normalizeSnippetLine(text);
        if (!normalized) continue;
        if (dropExact.has(normalized)) continue;
        if (seen.has(normalized)) continue;
        seen.add(normalized);
        out.push(text);
        if (out.length >= options.maxLines) break;
    }
    return out;
}

function normalizeSnippetLine(line: string): string {
    return String(line || "").replace(/\s+/g, " ").trim();
}

function normalizeSlashes(value: string): string {
    return String(value || "").replace(/\\/g, "/");
}

function escapeRegExp(value: string): string {
    return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildRuleNotes(item: NormalizedCallsiteItem): string[] | undefined {
    const notes: string[] = [];
    if (typeof (item as any).contextError === "string" && (item as any).contextError.trim()) {
        notes.push((item as any).contextError.trim());
    }
    const semanticFocus = normalizeSemanticFocus(item);
    if (isReturnedValueSemanticFocus(semanticFocus)) {
        notes.push("Focus this modeling item on the visible returned value. Treat this as a returned-value modeling question, not as a preselected source rule. Ignore request/input sink semantics in this focused item and decide whether the return is external/framework response data, a direct transfer, module-only handoff, no-transfer, or needs more evidence.");
    }
    if (isBridgeCandidate(item)) {
        notes.push("Bridge evidence is not a preselected module or rule. Use the provided bridgeEvidence observations to decide whether the visible surface is a one-surface rule, a cross-surface module, no-transfer, or needs more evidence. Do not enumerate possible reflected targets or explain every branch. If the matching registration, dispatch target, callback-return companion, or payload relation is not shown clearly enough for a valid artifact, immediately return status=need-more-evidence with one bounded request using kind=\"q_relation\", kind=\"q_endpoint\", or kind=\"q_evidence\" instead of inventing a broad bridge.");
    }
    return notes.length > 0 ? notes : undefined;
}

function normalizeSemanticFocus(item: NormalizedCallsiteItem): string {
    const raw = typeof (item as any).semanticFocus === "string"
        ? String((item as any).semanticFocus).trim()
        : "";
    return /^[a-z0-9_:-]+$/i.test(raw) ? raw : "";
}

function isReturnedValueSemanticFocus(semanticFocus: string): boolean {
    return semanticFocus === "returned_value_surface"
        || semanticFocus === "external_response_source";
}

function selectRuleTemplate(
    item: NormalizedCallsiteItem,
    companions: string[],
): SemanticFlowSlicePackage["template"] {
    const contextTexts = Array.isArray((item as any).contextSlices)
        ? ((item as any).contextSlices as CallsiteContextSlice[]).flatMap(slice => [
            slice.invokeStmtText,
            slice.windowLines,
            ...((slice.cfgNeighborStmts || []) as string[]),
        ])
        : [];
    const methodSnippet = typeof (item as any).methodSnippet === "string"
        ? String((item as any).methodSnippet)
        : "";
    const ownerMethodSnippets = Array.isArray((item as any).ownerMethodSnippets)
        ? (item as any).ownerMethodSnippets as Array<{ method?: string }>
        : [];
    const carrierMethodSnippets = Array.isArray((item as any).carrierMethodSnippets)
        ? (item as any).carrierMethodSnippets as Array<{ method?: string }>
        : [];
    const decoratorText = contextTexts.join("\n").toLowerCase();
    const lowered = [
        item.callee_signature,
        item.method,
        methodSnippet,
        ...contextTexts,
    ].join("\n").toLowerCase();
    if (isBridgeCandidate(item)) {
        return "multi-surface";
    }
    if (/(^|\s)@[a-z_]/i.test(decoratorText)) {
        return "declarative-binding";
    }
    if (
        lowered.includes("promise")
        || lowered.includes("=>")
        || lowered.includes("callback")
        || lowered.includes("listener")
        || lowered.includes("subscribe")
        || lowered.includes("emit")
        || lowered.includes("publish")
    ) {
        return "callable-transfer";
    }
    if (companions.length > 0) {
        return "multi-surface";
    }
    if (shouldInlineOwnerFamily(item) && ownerMethodSnippets.length > 0) {
        return "multi-surface";
    }
    if (shouldInlineCarrierEvidence(item) && carrierMethodSnippets.length > 0) {
        return "multi-surface";
    }
    return "call-return";
}

function buildRuleCompanionNames(companions?: NormalizedCallsiteItem[]): string[] {
    if (!companions || companions.length === 0) {
        return [];
    }
    return [...new Set(companions.map(item => String(item.method || "").trim()).filter(Boolean))];
}

function buildRuleCompanionList(
    item: NormalizedCallsiteItem,
    companions: string[],
): string[] | undefined {
    const ownerMethods = Array.isArray((item as any).ownerMethodSnippets)
        ? ((item as any).ownerMethodSnippets as Array<{ method?: string }>).map(entry => String(entry.method || "").trim()).filter(Boolean)
        : [];
    const carrierMethods = Array.isArray((item as any).carrierMethodSnippets)
        ? ((item as any).carrierMethodSnippets as Array<{ method?: string }>).map(entry => String(entry.method || "").trim()).filter(Boolean)
        : [];
    const merged = [...new Set([
        ...companions,
        ...(shouldInlineOwnerFamily(item) ? ownerMethods : []),
        ...(shouldInlineCarrierEvidence(item) ? carrierMethods : []),
    ])];
    return merged.length > 0 ? merged : undefined;
}

function shouldInlineOwnerFamily(item: NormalizedCallsiteItem): boolean {
    const contextSlices = Array.isArray((item as any).contextSlices)
        ? (item as any).contextSlices as CallsiteContextSlice[]
        : [];
    const methodSnippet = typeof (item as any).methodSnippet === "string"
        ? String((item as any).methodSnippet)
        : "";
    if (contextSlices.length > 0) {
        return false;
    }
    if (!methodSnippet.trim()) {
        return false;
    }
    return /return\s+[A-Za-z_$][\w$]*\.[A-Za-z_$][\w$]*\s*\(|[A-Za-z_$][\w$]*\.[A-Za-z_$][\w$]*\s*\(/.test(methodSnippet);
}

function shouldIncludeMethodSnippet(item: NormalizedCallsiteItem): boolean {
    return true;
}

function shouldInlineCarrierEvidence(item: NormalizedCallsiteItem): boolean {
    return hasCarrierEvidence(item);
}

function isBridgeCandidate(item: NormalizedCallsiteItem): boolean {
    const topEntries = Array.isArray(item.topEntries)
        ? item.topEntries.map(entry => String(entry || "").trim())
        : [];
    if (topEntries.some(entry => entry === "candidateBoundary=project_or_third_party_bridge_evidence")) {
        return true;
    }
    const methodSnippet = typeof (item as any).methodSnippet === "string"
        ? String((item as any).methodSnippet)
        : "";
    const sourceFile = String(item.sourceFile || "").toLowerCase();
    return /(^|\/)(bridge|bridges|jsbridge|webview)(\/|$)/.test(sourceFile)
        || /\b(runJavaScript|registerJavaScriptProxy|javaScriptProxy|JavaScriptInterface|callHandler|callJs|Reflect\.get|WebviewController|handlerMap)\b/.test(methodSnippet);
}

function selectBridgeCompanionCandidates(
    item: NormalizedCallsiteItem,
    companions: NormalizedCallsiteItem[],
): NormalizedCallsiteItem[] {
    const selfKey = `${item.callee_signature}|${item.sourceFile}|${item.method}|${item.argCount}`;
    return companions
        .filter(companion => `${companion.callee_signature}|${companion.sourceFile}|${companion.method}|${companion.argCount}` !== selfKey)
        .map((companion, index) => ({
            companion,
            index,
            tier: bridgeCompanionTier(companion),
        }))
        .sort((a, b) => a.tier - b.tier || a.index - b.index)
        .slice(0, 3)
        .map(entry => entry.companion);
}

function bridgeCompanionTier(companion: NormalizedCallsiteItem): number {
    const method = String(companion.method || "").toLowerCase();
    const text = [
        companion.callee_signature,
        companion.sourceFile,
        method,
        typeof (companion as any).methodSnippet === "string" ? (companion as any).methodSnippet : "",
    ].join("\n");
    if (/\b(registerjavascriptproxy|javascriptproxy|injectjavascript|setwebviewcontrollerproxy)\b/.test(method)) return 0;
    if (/\b(callbacktojs|returnvalue|handlerMap)\b/i.test(text)) return 1;
    if (/\b(calljs|callhandler|callhandlernoparam|calljsnoparam)\b/.test(method)) return 2;
    if (/\brunJavaScript\s*\(/.test(text)) return 3;
    if (/\bReflect\.get\b/.test(text)) return 4;
    if (/\bJSON\s*\.\s*(?:parse|stringify)\s*\(/.test(text)) return 5;
    return 6;
}

function buildBridgeEvidenceObservations(item: NormalizedCallsiteItem): string[] {
    if (!isBridgeCandidate(item)) {
        return [];
    }
    const evidence = new Set<string>();
    const text = [
        item.callee_signature,
        item.method,
        item.sourceFile,
        typeof (item as any).methodSnippet === "string" ? (item as any).methodSnippet : "",
    ].join("\n");
    if (/\bReflect\.get\b/.test(text) && /\.\s*call\s*\(/.test(text)) {
        evidence.add("bridgeEvidence=reflect_dispatch");
    }
    if (/\bJSON\s*\.\s*parse\s*\(/.test(text)) {
        evidence.add("bridgeEvidence=json_parse_boundary_input");
    }
    if (/\bJSON\s*\.\s*stringify\s*\(/.test(text)) {
        evidence.add("bridgeEvidence=json_stringify_boundary_output");
    }
    if (/\brunJavaScript\s*\(/.test(text)) {
        evidence.add("bridgeEvidence=native_to_js_run_javascript");
    }
    if (/\bregisterJavaScriptProxy\s*\(/.test(text)) {
        evidence.add("bridgeEvidence=register_js_proxy");
    }
    if (/\bhandlerMap\s*\.\s*(?:set|get|delete)\s*\(/.test(text)) {
        evidence.add("bridgeEvidence=callback_id_handler_map");
    }
    if (/@JavaScriptInterface\b/.test(text)) {
        evidence.add("bridgeEvidence=javascript_interface_entry");
    }
    if (/\bjavaScriptNamespaceInterfaces\s*\.\s*get\s*\(/.test(text)) {
        evidence.add("bridgeEvidence=namespace_interface_lookup");
    }
    if (/\bcallbackToJs\s*\(/.test(text)) {
        evidence.add("bridgeEvidence=callback_to_js_dispatch");
    }
    return [...evidence.values()].sort((a, b) => a.localeCompare(b));
}

function compactBridgeSnippet(snippet: string): string {
    const lines = String(snippet || "").split(/\r?\n/);
    if (lines.length <= 44) {
        return snippet;
    }
    const keep = new Set<number>();
    const patterns = [
        /\bReflect\.get\b/,
        /\.\s*call\s*\(/,
        /\bJSON\s*\.\s*(?:parse|stringify)\s*\(/,
        /\brunJavaScript\s*\(/,
        /\bregisterJavaScriptProxy\s*\(/,
        /\bhandlerMap\s*\.\s*(?:set|get|delete)\s*\(/,
        /@JavaScriptInterface\b/,
        /\bjavaScriptNamespaceInterfaces\s*\.\s*get\s*\(/,
        /\bcallbackToJs\s*\(/,
        /\breturn\b/,
        /\bmethodName\b/,
        /\bparams\b/,
        /\bdata\b/,
        /\bhandler\b/,
        /\bscript\b/,
    ];
    for (let index = 0; index < lines.length; index++) {
        const line = lines[index];
        if (!patterns.some(pattern => pattern.test(line))) {
            continue;
        }
        for (let offset = -1; offset <= 1; offset++) {
            const candidate = index + offset;
            if (candidate >= 0 && candidate < lines.length) {
                keep.add(candidate);
            }
        }
    }
    const ordered = [...keep.values()].sort((a, b) => a - b).slice(0, 30);
    if (ordered.length === 0) {
        return compactSnippetLines(lines, { maxLines: 44 }).join("\n");
    }
    const out: string[] = [];
    let previous = -2;
    for (const index of ordered) {
        if (previous >= 0 && index > previous + 1) {
            out.push("  ...");
        }
        out.push(lines[index]);
        previous = index;
    }
    return out.join("\n");
}

function hasCarrierEvidence(item: NormalizedCallsiteItem): boolean {
    const carrierRoots = Array.isArray((item as any).carrierRoots)
        ? ((item as any).carrierRoots as string[]).map(root => String(root || "").trim()).filter(Boolean)
        : [];
    const carrierMethodSnippets = Array.isArray((item as any).carrierMethodSnippets)
        ? (item as any).carrierMethodSnippets as Array<{ method?: string }>
        : [];
    return carrierRoots.length > 0 || carrierMethodSnippets.length > 0;
}

function sanitizeKey(value: string): string {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9.-]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/\.+/g, ".")
        .replace(/^[-.]+|[-.]+$/g, "") || "semanticflow";
}
