import type { Scene } from "../../../../arkanalyzer/out/src/Scene";
import type { TaintFlow } from "../../kernel/model/TaintFlow";
import type { ModuleRuntimeSpec } from "../../kernel/contracts/ModuleRuntimeSpec";
import { compileModuleRuntimeSpecs } from "../modules/ModuleRuntimeSpecCompiler";
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
        moduleRuntimeSpecs?: ModuleRuntimeSpec[];
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
    const generatedModules = compileModuleRuntimeSpecs(engineAugment.moduleRuntimeSpecs);

    const engine = new TaintPropagationEngine(scene, options.k ?? 1, {
        ...(options.engine || {}),
        transferRules: engineAugment.transferRules,
        modules: [...(options.engine?.modules || []), ...generatedModules],
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
        moduleRuntimeSpecs: [...(base?.moduleRuntimeSpecs || []), ...generated.moduleRuntimeSpecs],
    };
}
