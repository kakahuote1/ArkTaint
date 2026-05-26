import type { Scene } from "../../../arkanalyzer/out/src/Scene";
import { buildArkMainEntryCandidates } from "../entry/arkmain/llm/ArkMainEntryCandidateBuilder";
import { splitArkMainEntryCandidatesForSemanticFlow } from "../entry/arkmain/llm/ArkMainEntryCandidateFilter";
import type { ArkMainEntryCandidate } from "../entry/arkmain/llm/ArkMainEntryCandidateTypes";
import type { NormalizedCallsiteItem } from "../model/callsite/callsiteContextSlices";
import { buildSemanticFlowArkMainCandidateItem, buildSemanticFlowApiModelingCandidateItem } from "./SemanticFlowAdapters";
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
    ruleCompanionCandidates?: NormalizedCallsiteItem[];
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
    ineligibleArkMainCandidates: ArkMainEntryCandidate[];
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
    const {
        semanticFlowCandidates: arkMainCandidates,
        kernelCoveredCandidates: skippedArkMainCandidates,
        ineligibleCandidates: ineligibleArkMainCandidates,
    } =
        splitArkMainEntryCandidatesForSemanticFlow(rawArkMainCandidates);
    const ruleCandidates = options.ruleCandidates || [];
    const companionPool = options.ruleCompanionCandidates?.length
        ? options.ruleCompanionCandidates
        : ruleCandidates;
    const companionGroups = buildRuleCandidateCompanionGroups(companionPool);

    const items = [
        ...ruleCandidates.map(candidate => buildSemanticFlowApiModelingCandidateItem(candidate, {
            maxContextSlices: 1,
            companionCandidates: mergeRuleCompanionCandidates(
                companionGroups.get(semanticFlowRuleCandidateKey(candidate)) || [],
                sameDirectoryRuleCompanionCandidates(candidate, companionPool),
            ),
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
        ineligibleArkMainCandidates,
        ruleCandidateCount: ruleCandidates.length,
    };
}

function mergeRuleCompanionCandidates(...groups: NormalizedCallsiteItem[][]): NormalizedCallsiteItem[] {
    const seen = new Set<string>();
    const out: NormalizedCallsiteItem[] = [];
    for (const group of groups) {
        for (const candidate of group) {
            const key = semanticFlowRuleCandidateKey(candidate);
            if (seen.has(key)) {
                continue;
            }
            seen.add(key);
            out.push(candidate);
        }
    }
    return out;
}

function sameDirectoryRuleCompanionCandidates(
    candidate: NormalizedCallsiteItem,
    pool: NormalizedCallsiteItem[],
): NormalizedCallsiteItem[] {
    const dir = sourceDirectory(candidate.sourceFile);
    if (!dir) {
        return [];
    }
    return pool.filter(peer => sourceDirectory(peer.sourceFile) === dir);
}

function sourceDirectory(filePath: string | undefined): string {
    const normalized = String(filePath || "").replace(/\\/g, "/");
    const index = normalized.lastIndexOf("/");
    return index >= 0 ? normalized.slice(0, index) : "";
}
