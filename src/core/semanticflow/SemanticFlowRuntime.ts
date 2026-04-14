import type { Scene } from "../../../arkanalyzer/out/src/Scene";
import type { TaintFlow } from "../kernel/model/TaintFlow";
import type { ModuleSpec } from "../kernel/contracts/ModuleSpec";
import type { ArkMainSpec } from "../entry/arkmain/ArkMainSpec";
import { loadArkMainSeeds } from "../entry/arkmain/ArkMainLoader";
import { TaintPropagationEngine, type BuildPAGOptions, type TaintEngineOptions } from "../orchestration/TaintPropagationEngine";
import { buildSemanticFlowEngineAugment } from "./SemanticFlowArtifacts";
import type {
    SemanticFlowAnalysisAugment,
    SemanticFlowEngineAugment,
    SemanticFlowSessionResult,
} from "./SemanticFlowTypes";
import type {
    SanitizerRule,
    SinkRule,
    SourceRule,
    TransferRule,
} from "../rules/RuleSchema";

export interface SemanticFlowAnalysisOptions {
    k?: number;
    buildPAG?: BuildPAGOptions;
    engine?: Omit<TaintEngineOptions, "transferRules" | "moduleSpecs" | "arkMainSeeds">;
    base?: {
        sourceRules?: SourceRule[];
        sinkRules?: SinkRule[];
        sanitizerRules?: SanitizerRule[];
        transferRules?: TransferRule[];
        moduleSpecs?: ModuleSpec[];
        arkMainSpecs?: ArkMainSpec[];
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
    const arkMainSeeds = engineAugment.arkMainSpecs.length > 0
        ? loadArkMainSeeds(scene, {
            includeBuiltinArkMain: false,
            arkMainSpecs: engineAugment.arkMainSpecs,
        })
        : undefined;

    const engine = new TaintPropagationEngine(scene, options.k ?? 1, {
        ...(options.engine || {}),
        transferRules: engineAugment.transferRules,
        moduleSpecs: engineAugment.moduleSpecs,
        arkMainSeeds: arkMainSeeds && (arkMainSeeds.methods.length > 0 || arkMainSeeds.facts.length > 0)
            ? {
                methods: arkMainSeeds.methods,
                facts: arkMainSeeds.facts,
            }
            : undefined,
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
        moduleSpecs: [...(base?.moduleSpecs || []), ...generated.moduleSpecs],
        arkMainSpecs: dedupeArkMainSpecs([
            ...(base?.arkMainSpecs || []),
            ...(generated.arkMainSpecs || []),
        ]),
    };
}

function dedupeArkMainSpecs(specs: ArkMainSpec[]): ArkMainSpec[] {
    const out = new Map<string, ArkMainSpec>();
    for (const spec of specs) {
        const key = JSON.stringify(spec);
        if (!out.has(key)) {
            out.set(key, spec);
        }
    }
    return [...out.values()];
}
