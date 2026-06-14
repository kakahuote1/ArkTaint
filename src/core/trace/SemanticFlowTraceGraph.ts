import type { AssetDocumentBase } from "../assets/schema";
import { isAnalysisLoadableAssetStatus, validateAssetDocument } from "../assets/schema";
import { lowerModuleAssetToInternalModuleLoweringIR } from "../kernel/contracts/ModuleAssetLowering";
import { lowerRuleAssetsToRuleSet } from "../rules/RuleAssetLowering";
import type { PublishSemanticFlowProjectAssetsResult } from "../semanticflow/SemanticFlowProjectAssets";
import type { SemanticFlowPromotionRecord } from "../semanticflow/SemanticFlowRunRecord";
import type {
    SemanticFlowRuleInputNormalizationEvent,
    SemanticFlowRuleInputNormalizationTrace,
} from "../semanticflow/SemanticFlowRuleInputCandidates";
import type { SemanticFlowItemResult } from "../semanticflow/SemanticFlowTypes";
import { buildTraceGraph, FullTraceRun, TraceGate, TraceGraph } from "./TraceGraph";

export interface SemanticFlowTraceSourceRun {
    sourceDir: string;
    absPath?: string;
    status: "ok" | "missing" | "exception";
    itemCount?: number;
    ruleCandidateCount?: number;
    ruleBatchCount?: number;
    ruleCandidatePackagingTrace?: SemanticFlowRuleInputNormalizationTrace;
    arkMainCandidateCount?: number;
    arkMainIneligibleCount?: number;
    elapsedMs?: number;
    error?: string;
}

export interface SemanticFlowTraceGraphInput {
    run: FullTraceRun;
    items: readonly SemanticFlowItemResult[];
    assets?: readonly AssetDocumentBase[];
    publishedModel?: SemanticFlowPublishedModelTrace;
    promotionResults?: readonly SemanticFlowPromotionRecord[];
    sourceRuns?: readonly SemanticFlowTraceSourceRun[];
    summary?: Record<string, unknown>;
}

export interface SemanticFlowPublishedModelTrace {
    modelRoot: string;
    projectId: string;
    paths: PublishSemanticFlowProjectAssetsResult;
    assets: readonly AssetDocumentBase[];
}

export function buildSemanticFlowTraceGraph(input: SemanticFlowTraceGraphInput): TraceGraph {
    const gates: TraceGate[] = [];
    const pushGate = (gate: Omit<TraceGate, "id">): void => {
        gates.push({
            id: `gate:${gates.length + 1}`,
            ...gate,
        });
    };

    pushGate({
        stage: "coverage_ledger",
        producer: "coverage_ledger",
        gateKind: "coverage_query",
        scope: "coverage_ledger:semanticflow_session",
        attempted: input.items.length > 0,
        matched: input.items.length > 0,
        emitted: input.items.length > 0,
        skippedReason: input.items.length === 0 ? "coverage_ledger_no_gap_candidates" : undefined,
        evidence: {
            itemCount: input.items.length,
            assetCount: input.assets?.length || 0,
            summary: input.summary,
        },
    });

    for (const sourceRun of input.sourceRuns || []) {
        const ok = sourceRun.status === "ok";
        pushGate({
            stage: "preanalysis",
            producer: "preanalysis",
            gateKind: "coverage",
            scope: `semanticflow:source_dir:${sourceRun.sourceDir}`,
            attempted: true,
            matched: ok,
            emitted: ok,
            blockedReason: sourceRun.status === "exception" ? sourceRun.error || "semanticflow_source_dir_exception" : undefined,
            skippedReason: sourceRun.status === "missing" ? "semanticflow_source_dir_missing" : undefined,
            evidence: { ...sourceRun },
        });
        recordRuleCandidatePackagingGates(sourceRun, pushGate);
    }

    for (const item of input.items) {
        const emitted = !!item.asset && item.resolution === "resolved";
        const anchorEvidence = {
            anchorId: item.anchor.id,
            owner: item.anchor.owner,
            surface: item.anchor.surface,
            methodSignature: item.anchor.methodSignature,
            filePath: item.anchor.filePath,
            line: item.anchor.line,
            importSource: item.anchor.importSource,
            resolution: item.resolution,
            plane: item.plane || item.asset?.plane,
            assetId: item.asset?.id,
            assetStatus: item.asset?.status,
            finalSliceTemplate: item.finalSlice?.template,
            finalSliceRound: item.finalSlice?.round,
            historyRounds: item.history?.length || 0,
            error: item.error,
        };
        pushGate({
            label: item.anchor.id,
            stage: "coverage_ledger",
            producer: "coverage_ledger",
            gateKind: "coverage_query",
            scope: `coverage_ledger:item:${item.anchor.id}`,
            attempted: true,
            matched: true,
            emitted: emitted,
            skippedReason: emitted ? undefined : `coverage_gap_${item.resolution}`,
            evidence: {
                ...anchorEvidence,
                coverageStatus: emitted ? "covered-by-generated-asset" : "gap-needs-semanticflow",
            },
        });
        pushGate({
            label: item.anchor.id,
            stage: "semanticflow_llm",
            producer: "semanticflow",
            gateKind: "llm_batch",
            scope: `semanticflow_llm:batch:${item.anchor.id}`,
            attempted: item.resolution !== "irrelevant",
            matched: item.history.length > 0 || !!item.finalSlice,
            emitted: item.history.length > 0 || !!item.finalSlice,
            skippedReason: item.resolution === "irrelevant" ? "semanticflow_irrelevant_no_llm_batch" : undefined,
            evidence: {
                ...anchorEvidence,
                historyRounds: item.history.length,
                finalSliceTemplate: item.finalSlice?.template,
            },
        });
        pushGate({
            label: item.anchor.id,
            stage: "semanticflow_llm",
            producer: "semanticflow",
            gateKind: "llm_output",
            scope: `semanticflow_llm:output:${item.anchor.id}`,
            attempted: item.resolution !== "irrelevant",
            matched: item.resolution !== "irrelevant",
            emitted,
            skippedReason: emitted ? undefined : `semanticflow_llm_no_usable_asset_${item.resolution}`,
            blockedReason: item.error,
            evidence: anchorEvidence,
        });
        pushGate({
            label: item.anchor.id,
            stage: "semanticflow",
            producer: "semanticflow",
            gateKind: "candidate",
            scope: `semanticflow:item:${item.anchor.id}`,
            attempted: true,
            matched: item.resolution !== "irrelevant",
            emitted,
            skippedReason: emitted ? undefined : `semanticflow_${item.resolution}`,
            blockedReason: item.error,
            evidence: anchorEvidence,
        });
    }

    const assets = input.assets || input.items.map(item => item.asset).filter((asset): asset is AssetDocumentBase => !!asset);
    for (const asset of assets) {
        const validation = validateAssetDocument(asset);
        pushGate({
            label: asset.id,
            stage: "asset_validation",
            producer: "asset",
            gateKind: "validation",
            scope: `asset_validation:${asset.id}`,
            attempted: true,
            matched: true,
            emitted: validation.valid,
            blockedReason: validation.valid ? undefined : "asset_validation_failed",
            evidence: {
                assetId: asset.id,
                plane: asset.plane,
                status: asset.status,
                surfaceCount: asset.surfaces.length,
                bindingCount: asset.bindings.length,
                effectTemplateCount: asset.effectTemplates?.length || 0,
                relationCount: asset.relations?.length || 0,
                errors: validation.errors,
            },
        });
    }

    recordPublishedModelGates(input.publishedModel, assets, pushGate);

    for (const promotion of input.promotionResults || []) {
        pushGate({
            label: promotion.assetId,
            stage: "asset_promotion",
            producer: "asset",
            gateKind: "promotion",
            scope: `asset_promotion:${promotion.assetId}`,
            attempted: true,
            matched: promotion.accepted,
            emitted: promotion.accepted,
            blockedReason: promotion.accepted ? undefined : promotion.reason || "asset_promotion_rejected",
            evidence: {
                assetId: promotion.assetId,
                fromStatus: promotion.fromStatus,
                toStatus: promotion.toStatus,
                accepted: promotion.accepted,
                reason: promotion.reason,
            },
        });
    }

    return buildTraceGraph(input.run, [], [], gates);
}

function recordPublishedModelGates(
    publishedModel: SemanticFlowPublishedModelTrace | undefined,
    sourceAssets: readonly AssetDocumentBase[],
    pushGate: (gate: Omit<TraceGate, "id">) => void,
): void {
    if (!publishedModel) return;
    const sourceStatusesById = new Map(sourceAssets.map(asset => [asset.id, asset.status]));
    for (const asset of publishedModel.assets) {
        const validation = validateAssetDocument(asset);
        const loadableInEvaluation = validation.valid
            && isAnalysisLoadableAssetStatus(asset.status, "semanticflow-evaluation");
        pushGate({
            label: asset.id,
            stage: "asset_promotion",
            producer: "asset",
            gateKind: "promotion",
            scope: `asset_promotion:semanticflow_generated_model:${asset.id}`,
            attempted: true,
            matched: loadableInEvaluation,
            emitted: loadableInEvaluation,
            blockedReason: loadableInEvaluation ? undefined : "published_asset_not_evaluation_loadable",
            evidence: {
                assetId: asset.id,
                plane: asset.plane,
                fromStatus: sourceStatusesById.get(asset.id),
                toStatus: asset.status,
                modelRoot: publishedModel.modelRoot,
                projectId: publishedModel.projectId,
                rulePath: publishedModel.paths.rulePath,
                modulePath: publishedModel.paths.modulePath,
                arkMainPath: publishedModel.paths.arkMainPath,
                validationErrors: validation.errors,
            },
        });

        const lowering = inspectPublishedAssetLowering(asset);
        pushGate({
            label: asset.id,
            stage: "asset_lowering",
            producer: "asset",
            gateKind: "asset_lowering",
            scope: `asset_lowering:semanticflow_generated_model:${asset.id}`,
            attempted: true,
            matched: lowering.matched,
            emitted: lowering.emitted,
            skippedReason: lowering.skippedReason,
            blockedReason: lowering.blockedReason,
            evidence: {
                assetId: asset.id,
                plane: asset.plane,
                status: asset.status,
                modelRoot: publishedModel.modelRoot,
                projectId: publishedModel.projectId,
                ...lowering.evidence,
            },
        });
    }
}

function inspectPublishedAssetLowering(asset: AssetDocumentBase): {
    matched: boolean;
    emitted: boolean;
    skippedReason?: string;
    blockedReason?: string;
    evidence: Record<string, unknown>;
} {
    if (asset.plane === "rule") {
        const lowered = lowerRuleAssetsToRuleSet([asset], { loadMode: "semanticflow-evaluation" });
        const counts = {
            sourceRuleCount: lowered.ruleSet.sources.length,
            sinkRuleCount: lowered.ruleSet.sinks.length,
            sanitizerRuleCount: lowered.ruleSet.sanitizers?.length || 0,
            transferRuleCount: lowered.ruleSet.transfers.length,
        };
        const total = counts.sourceRuleCount
            + counts.sinkRuleCount
            + counts.sanitizerRuleCount
            + counts.transferRuleCount;
        return {
            matched: lowered.diagnostics.length === 0,
            emitted: lowered.diagnostics.length === 0 && total > 0,
            blockedReason: lowered.diagnostics.length > 0 ? "rule_asset_lowering_diagnostics" : undefined,
            skippedReason: lowered.diagnostics.length === 0 && total === 0 ? "rule_asset_no_loadable_rule_templates" : undefined,
            evidence: {
                ...counts,
                diagnostics: lowered.diagnostics,
            },
        };
    }

    if (asset.plane === "module") {
        try {
            const lowered = lowerModuleAssetToInternalModuleLoweringIR(asset, {
                loadMode: "semanticflow-evaluation",
            });
            return {
                matched: true,
                emitted: lowered.semantics.length > 0,
                skippedReason: lowered.semantics.length === 0 ? "module_asset_no_loadable_semantics" : undefined,
                evidence: {
                    moduleSemanticCount: lowered.semantics.length,
                    diagnostics: [],
                },
            };
        } catch (error) {
            return {
                matched: false,
                emitted: false,
                blockedReason: "module_asset_lowering_failed",
                evidence: {
                    diagnostics: [String((error as any)?.message || error)],
                },
            };
        }
    }

    return {
        matched: validateAssetDocument(asset).valid,
        emitted: validateAssetDocument(asset).valid,
        evidence: {
            arkMainBindingCount: asset.bindings.length,
            diagnostics: validateAssetDocument(asset).errors,
        },
    };
}

function recordRuleCandidatePackagingGates(
    sourceRun: SemanticFlowTraceSourceRun,
    pushGate: (gate: Omit<TraceGate, "id">) => void,
): void {
    const trace = sourceRun.ruleCandidatePackagingTrace;
    if (!trace) {
        pushGate({
            stage: "semanticflow",
            producer: "semanticflow",
            gateKind: "candidate",
            scope: `semanticflow:rule_input_normalization:${sourceRun.sourceDir}`,
            attempted: true,
            matched: false,
            emitted: false,
            skippedReason: "rule_input_normalization_trace_missing",
            evidence: {
                sourceDir: sourceRun.sourceDir,
            },
        });
        return;
    }

    pushGate({
        stage: "semanticflow",
        producer: "semanticflow",
        gateKind: "candidate",
        scope: `semanticflow:rule_input_normalization:${sourceRun.sourceDir}`,
        attempted: true,
        matched: trace.rawCount > 0,
        emitted: trace.normalizedCount > 0,
        skippedReason: trace.rawCount === 0 ? "rule_input_empty" : undefined,
        evidence: {
            sourceDir: sourceRun.sourceDir,
            rawCount: trace.rawCount,
            normalizedCount: trace.normalizedCount,
            returnedValueSiblingCreatedCount: trace.returnedValueSiblingCreatedCount,
        },
    });

    for (const event of trace.events) {
        pushGate(ruleInputNormalizationEventToGate(sourceRun.sourceDir, event));
    }
}

function ruleInputNormalizationEventToGate(
    sourceDir: string,
    event: SemanticFlowRuleInputNormalizationEvent,
): Omit<TraceGate, "id"> {
    const candidate = event.sibling || event.item;
    const created = event.kind === "returned_value_sibling_created";
    const observed = event.kind === "input_candidate";
    const skipped = event.kind === "returned_value_sibling_skipped";
    return {
        label: candidate.key,
        stage: "semanticflow",
        producer: "semanticflow",
        gateKind: "candidate",
        scope: `semanticflow:rule_input_candidate_packaging:${sourceDir}:${candidate.key}`,
        attempted: true,
        matched: observed || created,
        emitted: observed || created,
        skippedReason: skipped ? event.reason : undefined,
        evidence: {
            sourceDir,
            eventKind: event.kind,
            reason: event.reason,
            item: event.item,
            sibling: event.sibling,
            method: candidate.method,
            calleeSignature: candidate.calleeSignature,
            sourceFile: candidate.sourceFile,
            candidateOrigin: candidate.candidateOrigin,
            semanticFocus: candidate.semanticFocus,
            returnType: candidate.returnType,
        },
    };
}
