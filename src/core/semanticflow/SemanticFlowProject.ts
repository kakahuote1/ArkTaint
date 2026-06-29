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
    const ruleCandidates = options.ruleCandidates || [];
    const arkMainCandidateLimit = options.arkMainMaxCandidates ?? 32;
    const rawArkMainCandidates = options.includeArkMainCandidates === false
        ? []
        : buildArkMainEntryCandidates(options.scene as never, {
            maxCandidates: resolveRawArkMainCandidateLimit(arkMainCandidateLimit, ruleCandidates.length),
        });
    const {
        semanticFlowCandidates: arkMainCandidates,
        kernelCoveredCandidates: skippedArkMainCandidates,
        ineligibleCandidates: ineligibleArkMainCandidates,
    } =
        splitArkMainEntryCandidatesForSemanticFlow(rawArkMainCandidates);
    const selectedArkMainCandidates = selectArkMainCandidatesForRuleContext(
        arkMainCandidates,
        ruleCandidates,
        arkMainCandidateLimit,
    );
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
        ...selectedArkMainCandidates.map(candidate => buildSemanticFlowArkMainCandidateItem(candidate)),
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
        arkMainCandidates: selectedArkMainCandidates,
        skippedArkMainCandidates,
        ineligibleArkMainCandidates,
        ruleCandidateCount: ruleCandidates.length,
    };
}

function resolveRawArkMainCandidateLimit(finalLimit: number, ruleCandidateCount: number): number {
    const expandedForContext = Math.max(finalLimit * 16, finalLimit + ruleCandidateCount * 4, 128);
    return Math.min(Math.max(finalLimit, expandedForContext), 512);
}

export function selectArkMainCandidatesForRuleContext(
    candidates: ArkMainEntryCandidate[],
    ruleCandidates: NormalizedCallsiteItem[],
    maxCandidates = candidates.length,
): ArkMainEntryCandidate[] {
    const limit = Math.max(0, maxCandidates);
    if (limit === 0) {
        return [];
    }
    const callerFiles = collectRuleCallerFiles(ruleCandidates);
    const seen = new Set<string>();
    const out: ArkMainEntryCandidate[] = [];
    const push = (candidate: ArkMainEntryCandidate): void => {
        const key = candidate.methodSignature || `${candidate.className}.${candidate.methodName}`;
        if (!key || seen.has(key)) {
            return;
        }
        seen.add(key);
        out.push(candidate);
    };

    const related = candidates
        .filter(candidate => isCandidateInCallerFile(candidate, callerFiles))
        .sort(compareRelatedArkMainCandidates);
    for (const candidate of related) {
        if (out.length >= limit) break;
        push(candidate);
    }
    for (const candidate of candidates) {
        if (out.length >= limit) break;
        push(candidate);
    }
    return out;
}

function collectRuleCallerFiles(ruleCandidates: NormalizedCallsiteItem[]): Set<string> {
    const out = new Set<string>();
    for (const candidate of ruleCandidates) {
        const contexts = Array.isArray((candidate as any).contextSlices)
            ? (candidate as any).contextSlices
            : [];
        for (const context of contexts) {
            const callerFile = normalizePathKey((context as any)?.callerFile);
            if (callerFile) {
                out.add(callerFile);
            }
        }
    }
    return out;
}

function isCandidateInCallerFile(candidate: ArkMainEntryCandidate, callerFiles: Set<string>): boolean {
    if (callerFiles.size === 0) {
        return false;
    }
    const candidateFile = normalizePathKey(candidate.filePath);
    if (!candidateFile) {
        return false;
    }
    for (const callerFile of callerFiles) {
        if (candidateFile === callerFile || candidateFile.endsWith(`/${callerFile}`)) {
            return true;
        }
    }
    return false;
}

function compareRelatedArkMainCandidates(left: ArkMainEntryCandidate, right: ArkMainEntryCandidate): number {
    return arkMainMethodRank(left) - arkMainMethodRank(right)
        || arkMainSignalCompletenessRank(left) - arkMainSignalCompletenessRank(right)
        || left.methodSignature.localeCompare(right.methodSignature);
}

function arkMainMethodRank(candidate: ArkMainEntryCandidate): number {
    const methodName = String(candidate.methodName || "").toLowerCase();
    if (methodName === "build") return 0;
    if (methodName === "initialrender" || methodName === "rerender") return 1;
    if (methodName === "abouttoappear" || methodName === "abouttodisappear") return 2;
    return 3;
}

function arkMainSignalCompletenessRank(candidate: ArkMainEntryCandidate): number {
    if (candidate.ownerSignals.length > 0 && candidate.overrideSignals.length > 0 && candidate.frameworkSignals.length > 0) return 0;
    if (candidate.ownerSignals.length > 0 && candidate.frameworkSignals.length > 0) return 1;
    if (candidate.ownerSignals.length > 0 || candidate.frameworkSignals.length > 0) return 2;
    return 3;
}

function normalizePathKey(value: unknown): string {
    return String(value || "")
        .replace(/\\/g, "/")
        .replace(/^\.\//, "")
        .trim();
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
