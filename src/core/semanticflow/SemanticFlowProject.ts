import type { Scene } from "../../../arkanalyzer/out/src/Scene";
import { buildArkMainEntryCandidates } from "../entry/arkmain/llm/ArkMainEntryCandidateBuilder";
import type { ArkMainEntryCandidate } from "../entry/arkmain/llm/ArkMainEntryCandidateTypes";
import type { NormalizedCallsiteItem } from "../model/callsite/callsiteContextSlices";
import { buildSemanticFlowArkMainCandidateItem, buildSemanticFlowRuleCandidateItem } from "./SemanticFlowAdapters";
import { buildSemanticFlowAnalysisAugment } from "./SemanticFlowArtifacts";
import { createArkMainCandidateExpander, createCompositeSemanticFlowExpander, createRuleCandidateExpander } from "./SemanticFlowExpanders";
import { createSemanticFlowLlmDecider, type SemanticFlowModelInvoker } from "./SemanticFlowLlm";
import { runSemanticFlowSession, type SemanticFlowProgressEvent } from "./SemanticFlowPipeline";
import type { SemanticFlowSessionResult } from "./SemanticFlowTypes";

export interface SemanticFlowProjectOptions {
    scene: Scene;
    modelInvoker: SemanticFlowModelInvoker;
    model?: string;
    ruleCandidates?: NormalizedCallsiteItem[];
    includeArkMainCandidates?: boolean;
    arkMainMaxCandidates?: number;
    maxRounds?: number;
    concurrency?: number;
    onProgress?: (event: SemanticFlowProgressEvent) => void;
}

export interface SemanticFlowProjectResult {
    session: SemanticFlowSessionResult;
    arkMainCandidates: ArkMainEntryCandidate[];
    ruleCandidateCount: number;
}

export async function runSemanticFlowProject(
    options: SemanticFlowProjectOptions,
): Promise<SemanticFlowProjectResult> {
    const arkMainCandidates = options.includeArkMainCandidates === false
        ? []
        : buildArkMainEntryCandidates(options.scene as never, {
            maxCandidates: options.arkMainMaxCandidates,
        });
    const ruleCandidates = options.ruleCandidates || [];
    const companionGroups = buildRuleCompanionGroups(ruleCandidates);

    const items = [
        ...ruleCandidates.map(candidate => buildSemanticFlowRuleCandidateItem(candidate, {
            maxContextSlices: 1,
            companionCandidates: companionGroups.get(ruleCandidateKey(candidate)) || [],
        })),
        ...arkMainCandidates.map(candidate => buildSemanticFlowArkMainCandidateItem(candidate)),
    ];

    const decider = createSemanticFlowLlmDecider({
        model: options.model,
        modelInvoker: options.modelInvoker,
    });
    const expander = createCompositeSemanticFlowExpander([
        createRuleCandidateExpander(ruleCandidates),
        createArkMainCandidateExpander(arkMainCandidates),
    ]);
    const session = await runSemanticFlowSession(items, decider, expander, {
        maxRounds: options.maxRounds ?? 2,
        concurrency: options.concurrency ?? 4,
        onProgress: options.onProgress,
    });

    return {
        session: {
            ...session,
            augment: buildSemanticFlowAnalysisAugment(session.run.items),
            engineAugment: session.engineAugment,
        },
        arkMainCandidates,
        ruleCandidateCount: ruleCandidates.length,
    };
}

function buildRuleCompanionGroups(candidates: NormalizedCallsiteItem[]): Map<string, NormalizedCallsiteItem[]> {
    const grouped = new Map<string, NormalizedCallsiteItem[]>();
    for (const candidate of candidates) {
        const key = companionGroupKey(candidate);
        const bucket = grouped.get(key) || [];
        bucket.push(candidate);
        grouped.set(key, bucket);
    }
    const out = new Map<string, NormalizedCallsiteItem[]>();
    for (const candidate of candidates) {
        const key = companionGroupKey(candidate);
        const companions = (grouped.get(key) || []).filter(peer =>
            peer.callee_signature !== candidate.callee_signature
            || peer.method !== candidate.method
            || peer.argCount !== candidate.argCount,
        );
        out.set(ruleCandidateKey(candidate), companions);
    }
    return out;
}

function companionGroupKey(candidate: NormalizedCallsiteItem): string {
    const owner = extractDeclaringClassFromMethodSignature(candidate.callee_signature);
    return owner
        ? `${owner}|${candidate.sourceFile}`
        : `__anchor__|${candidate.callee_signature}|${candidate.sourceFile}|${candidate.invokeKind}|${candidate.argCount}`;
}

function ruleCandidateKey(candidate: NormalizedCallsiteItem): string {
    return [
        candidate.callee_signature,
        candidate.sourceFile,
        String(candidate.argCount),
        candidate.invokeKind,
    ].join("|");
}

function extractDeclaringClassFromMethodSignature(signature: string): string | undefined {
    const openParen = signature.indexOf("(");
    const methodDot = signature.lastIndexOf(".", openParen >= 0 ? openParen : signature.length);
    if (methodDot < 0) return undefined;
    return signature.slice(0, methodDot).trim();
}
