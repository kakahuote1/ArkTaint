import * as fs from "fs";
import * as path from "path";

export type CompareLayer = "mechanism_benchmark" | "boundary_control" | "blind_reserved" | "natural_sample_reserved";
export type CompareCarrier = "direct_callable" | "returned_callable" | "field_callable" | "slot_callable";
export type CompareTrigger = "call" | "event" | "settle_fulfilled" | "settle_rejected" | "settle_any";
export type ComparePayload = "none" | "param0" | "param1" | "multi";
export type CompareCapture = "none" | "capture_in" | "capture_out" | "capture_in_out";
export type CompareResume = "none" | "promise_chain" | "await_site";
export type CompareBindingSite = "local" | "samefile_helper" | "crossfile_helper" | "field" | "slot";
export type ComparePolarity = "positive" | "negative";
export type CompareSeedMode = "manual_local_seed" | "source_rules";

export interface ExecutionHandoffCompareFactors {
    carrier: CompareCarrier;
    trigger: CompareTrigger;
    payload: ComparePayload;
    capture: CompareCapture;
    resume: CompareResume;
    relayDepth: number;
    bindingSite: CompareBindingSite;
    deferred: boolean;
}

export interface ExecutionHandoffCompareCase {
    caseName: string;
    expected: boolean;
    layer: CompareLayer;
    twinGroup: string;
    semanticFamily?: string;
    variantId?: string;
    polarity: ComparePolarity;
    semanticFlip: string;
    note: string;
    factors: ExecutionHandoffCompareFactors;
}

export interface ExecutionHandoffCompareRuntime {
    seedMode?: CompareSeedMode;
    defaultRulePath?: string;
    projectRulePath?: string;
    includeBuiltinSemanticPacks?: boolean;
    includeBuiltinEnginePlugins?: boolean;
}

export interface ExecutionHandoffCompareManifest {
    version: number;
    name: string;
    sourceDir: string;
    purpose: string;
    globalFactorUniverse: Record<string, Array<string | number | boolean>>;
    activeCompareScope: {
        name: string;
        outputTag?: string;
        activeLayers?: CompareLayer[];
        rationale: string[];
        fixedFactors: Record<string, string[]>;
        deferredFocus: string[];
        controlRows: string[];
        excludedForNow: string[];
    };
    twinRules: string[];
    runtime?: ExecutionHandoffCompareRuntime;
    cases: ExecutionHandoffCompareCase[];
}

export function executionHandoffCompareManifestPath(): string {
    return path.resolve("tests/adhoc/execution_handoff_compare/compare_manifest.json");
}

export function loadExecutionHandoffCompareManifest(manifestPath = executionHandoffCompareManifestPath()): ExecutionHandoffCompareManifest {
    return JSON.parse(fs.readFileSync(manifestPath, "utf8")) as ExecutionHandoffCompareManifest;
}

export function activeExecutionHandoffCompareCases(
    manifest: ExecutionHandoffCompareManifest,
    layers: CompareLayer[] = manifest.activeCompareScope.activeLayers || ["mechanism_benchmark", "boundary_control"],
): ExecutionHandoffCompareCase[] {
    const allowed = new Set(layers);
    return manifest.cases.filter(item => allowed.has(item.layer));
}

export function executionHandoffCompareOutputTag(manifest: ExecutionHandoffCompareManifest): string {
    return manifest.activeCompareScope.outputTag || manifest.activeCompareScope.name;
}

export function normalizeCompareFactors(factors: ExecutionHandoffCompareFactors): string {
    return JSON.stringify(
        {
            carrier: factors.carrier,
            trigger: factors.trigger,
            payload: factors.payload,
            capture: factors.capture,
            resume: factors.resume,
            relayDepth: factors.relayDepth,
            bindingSite: factors.bindingSite,
            deferred: factors.deferred,
        },
    );
}
