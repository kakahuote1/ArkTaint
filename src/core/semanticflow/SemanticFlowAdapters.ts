import type { ArkMainEntryCandidate } from "../entry/arkmain/llm/ArkMainEntryCandidateTypes";
import type { ArkMainSelector } from "../entry/arkmain/ArkMainSpec";
import type { CallsiteContextSlice, NormalizedCallsiteItem } from "../model/callsite/callsiteContextSlices";
import type { SemanticFlowPipelineItemInput } from "./SemanticFlowPipeline";
import type { SemanticFlowAnchor, SemanticFlowSliceCodeSnippet, SemanticFlowSlicePackage } from "./SemanticFlowTypes";

export interface SemanticFlowRuleCandidateAdapterOptions {
    maxContextSlices?: number;
    companionCandidates?: NormalizedCallsiteItem[];
}

export function buildSemanticFlowRuleCandidateItem(
    item: NormalizedCallsiteItem,
    options: SemanticFlowRuleCandidateAdapterOptions = {},
): SemanticFlowPipelineItemInput {
    const anchorId = sanitizeKey([
        "rule",
        item.callee_signature,
        item.sourceFile,
        String(item.argCount),
        item.invokeKind,
    ].join("."));

    const companions = buildRuleCompanionNames(options.companionCandidates);
    return {
        anchor: {
            id: anchorId,
            owner: extractDeclaringClassFromMethodSignature(item.callee_signature),
            surface: item.method || "unknown",
            methodSignature: item.callee_signature,
            filePath: item.sourceFile,
            importSource: item.sourceFile,
            metaTags: ["rule", "candidate", item.invokeKind],
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

function buildArkMainSelector(candidate: ArkMainEntryCandidate): ArkMainSelector {
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
    const contextSlices = Array.isArray((item as any).contextSlices) ? (item as any).contextSlices as CallsiteContextSlice[] : [];
    if (contextSlices.length > 0) {
        observations.push(`contextSlices=${contextSlices.length}`);
    }
    if (typeof (item as any).methodSnippet === "string" && (item as any).methodSnippet.trim()) {
        observations.push("methodSnippet=available");
    }
    const ownerMethodSnippets = Array.isArray((item as any).ownerMethodSnippets)
        ? (item as any).ownerMethodSnippets as Array<{ method?: string }>
        : [];
    if (ownerMethodSnippets.length > 0) {
        observations.push(`ownerMethodSnippets=${ownerMethodSnippets.length}`);
    }
    if (typeof item.count === "number") {
        observations.push(`count=${item.count}`);
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

    for (const [index, slice] of visibleSlices.entries()) {
        snippets.push({
            label: `callsite-${index}`,
            code: [
                `callerFile: ${slice.callerFile}`,
                `callerMethod: ${slice.callerMethod || "-"}`,
                `invokeLine: ${slice.invokeLine}`,
                `invokeStmt: ${slice.invokeStmtText}`,
                "",
                slice.windowLines,
                ...(slice.cfgNeighborStmts?.length
                    ? ["", "cfgNeighbors:", ...slice.cfgNeighborStmts]
                    : []),
            ].join("\n"),
        });
    }

    const methodSnippet = typeof (item as any).methodSnippet === "string"
        ? String((item as any).methodSnippet).trim()
        : "";

    if (methodSnippet) {
        snippets.push({
            label: "method",
            code: methodSnippet,
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

    for (const companion of (companionCandidates || []).slice(0, 2)) {
        snippets.push({
            label: `companion-${companion.method || "surface"}`,
            code: [
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

function buildRuleNotes(item: NormalizedCallsiteItem): string[] | undefined {
    const notes: string[] = [];
    if (typeof (item as any).contextError === "string" && (item as any).contextError.trim()) {
        notes.push((item as any).contextError.trim());
    }
    return notes.length > 0 ? notes : undefined;
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
    const decoratorText = contextTexts.join("\n").toLowerCase();
    const lowered = [
        item.callee_signature,
        item.method,
        methodSnippet,
        ...contextTexts,
    ].join("\n").toLowerCase();
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
    const merged = [...new Set([...companions, ...(shouldInlineOwnerFamily(item) ? ownerMethods : [])])];
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

function extractDeclaringClassFromMethodSignature(signature: string): string | undefined {
    const openParen = signature.indexOf("(");
    const methodDot = signature.lastIndexOf(".", openParen >= 0 ? openParen : signature.length);
    if (methodDot < 0) return undefined;
    return signature.slice(0, methodDot).trim();
}

function sanitizeKey(value: string): string {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9.-]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/\.+/g, ".")
        .replace(/^[-.]+|[-.]+$/g, "") || "semanticflow";
}
