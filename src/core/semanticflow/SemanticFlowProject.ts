import type { Scene } from "../../../arkanalyzer/out/src/Scene";
import { buildArkMainEntryCandidates } from "../entry/arkmain/llm/ArkMainEntryCandidateBuilder";
import { splitArkMainEntryCandidatesForSemanticFlow } from "../entry/arkmain/llm/ArkMainEntryCandidateFilter";
import type { ArkMainEntryCandidate } from "../entry/arkmain/llm/ArkMainEntryCandidateTypes";
import type { NormalizedCallsiteItem } from "../model/callsite/callsiteContextSlices";
import { buildSemanticFlowArkMainCandidateItem, buildSemanticFlowRuleCandidateItem } from "./SemanticFlowAdapters";
import { createArkMainCandidateExpander, createCompositeSemanticFlowExpander, createRuleCandidateExpander } from "./SemanticFlowExpanders";
import { createSemanticFlowLlmDecider, type SemanticFlowModelInvoker } from "./SemanticFlowLlm";
import { runSemanticFlowSession, type SemanticFlowProgressEvent } from "./SemanticFlowPipeline";
import type { SemanticFlowSessionCache } from "./SemanticFlowSessionCache";
import { buildRuleCandidateCompanionGroups, semanticFlowRuleCandidateKey } from "./SemanticFlowRuleCompanions";
import type { SemanticFlowSessionResult } from "./SemanticFlowTypes";

export interface SemanticFlowProjectOptions {
    scene: Scene;
    modelInvoker: SemanticFlowModelInvoker;
    model?: string;
    ruleCandidates?: NormalizedCallsiteItem[];
    includeArkMainCandidates?: boolean;
    arkMainMaxCandidates?: number;
    maxRounds?: number;
    maxRepairAttempts?: number;
    concurrency?: number;
    onProgress?: (event: SemanticFlowProgressEvent) => void;
    sessionCache?: SemanticFlowSessionCache;
}

export interface SemanticFlowProjectResult {
    session: SemanticFlowSessionResult;
    arkMainCandidates: ArkMainEntryCandidate[];
    skippedArkMainCandidates: ArkMainEntryCandidate[];
    ruleCandidateCount: number;
}

export async function runSemanticFlowProject(
    options: SemanticFlowProjectOptions,
): Promise<SemanticFlowProjectResult> {
    const rawArkMainCandidates = options.includeArkMainCandidates === false
        ? []
        : buildArkMainEntryCandidates(options.scene as never, {
            maxCandidates: options.arkMainMaxCandidates,
        });
    const { semanticFlowCandidates: arkMainCandidates, kernelCoveredCandidates: skippedArkMainCandidates } =
        splitArkMainEntryCandidatesForSemanticFlow(rawArkMainCandidates);
    const ruleCandidates = options.ruleCandidates || [];
    const companionGroups = buildRuleCandidateCompanionGroups(ruleCandidates);

    const items = [
        ...ruleCandidates.map(candidate => buildSemanticFlowRuleCandidateItem(candidate, {
            maxContextSlices: 1,
            companionCandidates: companionGroups.get(semanticFlowRuleCandidateKey(candidate)) || [],
        })),
        ...arkMainCandidates.map(candidate => buildSemanticFlowArkMainCandidateItem(candidate)),
    ];

    const decider = createSemanticFlowLlmDecider({
        model: options.model,
        modelInvoker: options.modelInvoker,
        maxRepairAttempts: options.maxRepairAttempts,
        sessionCache: options.sessionCache,
    });
    const expander = createCompositeSemanticFlowExpander([
        createRuleCandidateExpander(ruleCandidates),
        createArkMainCandidateExpander(arkMainCandidates),
    ]);
    const session = await runSemanticFlowSession(items, decider, expander, {
        maxRounds: options.maxRounds ?? 2,
        concurrency: options.concurrency ?? 4,
        onProgress: options.onProgress,
        model: options.model,
        sessionCache: options.sessionCache,
    });

    return {
        session,
        arkMainCandidates,
        skippedArkMainCandidates,
        ruleCandidateCount: ruleCandidates.length,
    };
}
