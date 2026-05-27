import type { Scene } from "../../../../arkanalyzer/out/src/Scene";
import type { AssetDocumentBase } from "../../assets/schema";
import { isTrustedAnalysisAssetStatus } from "../../assets/schema";
import { lowerModuleAssetsToInternalModuleLoweringIRs } from "../../kernel/contracts/ModuleAssetLowering";
import type { TaintFlow } from "../../kernel/model/TaintFlow";
import type { TaintModule } from "../../kernel/contracts/ModuleApi";
import { compileInternalModuleLoweringIRs } from "../modules/InternalModuleLoweringIRCompiler";
import { TaintPropagationEngine, type BuildPAGOptions, type TaintEngineOptions } from "../TaintPropagationEngine";
import {
    buildSemanticFlowEngineAugment,
    consolidateSemanticFlowAnalysisAugmentByFootprint,
} from "../../semanticflow/SemanticFlowArtifacts";
import type {
    SemanticFlowAnalysisAugment,
    SemanticFlowEngineAugment,
    SemanticFlowSessionResult,
} from "../../semanticflow/SemanticFlowTypes";
import type {
    SanitizerRule,
    SinkRule,
    SourceRule,
    TransferRule,
} from "../../rules/RuleSchema";

export interface SemanticFlowAnalysisOptions {
    k?: number;
    buildPAG?: BuildPAGOptions;
    engine?: Omit<TaintEngineOptions, "transferRules" | "arkMainSeeds">;
    base?: {
        sourceRules?: SourceRule[];
        sinkRules?: SinkRule[];
        sanitizerRules?: SanitizerRule[];
        transferRules?: TransferRule[];
        modules?: TaintModule[];
    };
    sink?: {
        stopOnFirstFlow?: boolean;
        maxFlowsPerEntry?: number;
    };
}

export interface SemanticFlowAnalysisResult {
    engine: TaintPropagationEngine;
    augment: SemanticFlowAnalysisAugment;
    engineAugment: SemanticFlowEngineAugment;
    seedInfo: ReturnType<TaintPropagationEngine["propagateWithSourceRules"]>;
    flows: TaintFlow[];
}

export async function runSemanticFlowAnalysis(
    scene: Scene,
    input: SemanticFlowSessionResult | SemanticFlowAnalysisAugment,
    options: SemanticFlowAnalysisOptions = {},
): Promise<SemanticFlowAnalysisResult> {
    const augment = isSessionResult(input) ? input.augment : input;
    const generatedAugment = isSessionResult(input) ? input.engineAugment : buildSemanticFlowEngineAugment(augment);
    const engineAugment = mergeEngineAugment(generatedAugment, options.base);
    const generatedModules = compileSemanticFlowModuleAssets(augment.assets);
    const engine = new TaintPropagationEngine(scene, options.k ?? 1, {
        ...(options.engine || {}),
        transferRules: engineAugment.transferRules,
        modules: [...(options.engine?.modules || []), ...(options.base?.modules || []), ...generatedModules],
    });
    engine.verbose = false;
    await engine.buildPAG(options.buildPAG || { entryModel: "arkMain" });

    const seedInfo = engine.propagateWithSourceRules(engineAugment.sourceRules);
    const flows = engine.detectSinksByRules(engineAugment.sinkRules, {
        sanitizerRules: engineAugment.sanitizerRules,
        stopOnFirstFlow: options.sink?.stopOnFirstFlow,
        maxFlowsPerEntry: options.sink?.maxFlowsPerEntry,
    });

    return {
        engine,
        augment,
        engineAugment,
        seedInfo,
        flows,
    };
}

function isSessionResult(value: SemanticFlowSessionResult | SemanticFlowAnalysisAugment): value is SemanticFlowSessionResult {
    return Boolean((value as SemanticFlowSessionResult).run && (value as SemanticFlowSessionResult).augment);
}

function mergeEngineAugment(
    generated: SemanticFlowEngineAugment,
    base?: SemanticFlowAnalysisOptions["base"],
): SemanticFlowEngineAugment {
    return {
        sourceRules: [...(base?.sourceRules || []), ...generated.sourceRules],
        sinkRules: [...(base?.sinkRules || []), ...generated.sinkRules],
        sanitizerRules: [...(base?.sanitizerRules || []), ...generated.sanitizerRules],
        transferRules: [...(base?.transferRules || []), ...generated.transferRules],
    };
}

function compileSemanticFlowModuleAssets(assets: readonly AssetDocumentBase[]): TaintModule[] {
    const loadable = assets.filter(asset =>
        asset.plane === "module"
        && isTrustedAnalysisAssetStatus(asset.status)
        && (asset.effectTemplates || []).some(template =>
            template.kind === "core.capability"
            || template.kind === "handoff.put"
            || template.kind === "handoff.get"
            || template.kind === "handoff.kill"
            || template.kind === "handoff.link",
        ),
    );
    return loadable.length > 0
        ? compileInternalModuleLoweringIRs(lowerModuleAssetsToInternalModuleLoweringIRs([...loadable]))
        : [];
}
