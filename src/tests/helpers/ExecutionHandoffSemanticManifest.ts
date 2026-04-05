import * as fs from "fs";
import * as path from "path";

export type SemanticLayer = "mechanism_benchmark" | "boundary_control" | "blind_reserved" | "natural_sample_reserved";
export type SemanticCarrier = "direct_callable" | "returned_callable" | "field_callable" | "slot_callable";
export type SemanticTrigger = "call" | "event" | "settle_fulfilled" | "settle_rejected" | "settle_any";
export type SemanticPayload = "none" | "param0" | "param1" | "multi";
export type SemanticCapture = "none" | "capture_in" | "capture_out" | "capture_in_out";
export type SemanticResume = "none" | "promise_chain" | "await_site";
export type SemanticBindingSite = "local" | "samefile_helper" | "crossfile_helper" | "field" | "slot";
export type SemanticPolarity = "positive" | "negative";
export type SemanticSeedMode = "manual_local_seed" | "source_rules";

export interface ExecutionHandoffSemanticFactors {
    carrier: SemanticCarrier;
    trigger: SemanticTrigger;
    payload: SemanticPayload;
    capture: SemanticCapture;
    resume: SemanticResume;
    relayDepth: number;
    bindingSite: SemanticBindingSite;
    deferred: boolean;
}

export interface ExecutionHandoffSemanticCase {
    caseName: string;
    expected: boolean;
    layer: SemanticLayer;
    twinGroup: string;
    semanticFamily?: string;
    variantId?: string;
    polarity: SemanticPolarity;
    semanticFlip: string;
    note: string;
    factors: ExecutionHandoffSemanticFactors;
}

export interface ExecutionHandoffSemanticRuntime {
    seedMode?: SemanticSeedMode;
    kernelRulePath?: string;
    projectRulePath?: string;
    includeBuiltinModules?: boolean;
    includeBuiltinEnginePlugins?: boolean;
}

export interface ExecutionHandoffSemanticManifest {
    version: number;
    name: string;
    sourceDir: string;
    purpose: string;
    globalFactorUniverse: Record<string, Array<string | number | boolean>>;
    activeSemanticScope: {
        name: string;
        outputTag?: string;
        activeLayers?: SemanticLayer[];
        rationale: string[];
        fixedFactors: Record<string, string[]>;
        deferredFocus: string[];
        controlRows: string[];
        excludedForNow: string[];
    };
    twinRules: string[];
    runtime?: ExecutionHandoffSemanticRuntime;
    cases: ExecutionHandoffSemanticCase[];
}

export function executionHandoffSemanticManifestPath(): string {
    return path.resolve("tests/adhoc/execution_handoff_semantic_event/manifest.json");
}

export function loadExecutionHandoffSemanticManifest(manifestPath = executionHandoffSemanticManifestPath()): ExecutionHandoffSemanticManifest {
    return JSON.parse(fs.readFileSync(manifestPath, "utf8")) as ExecutionHandoffSemanticManifest;
}

export function activeExecutionHandoffSemanticCases(
    manifest: ExecutionHandoffSemanticManifest,
    layers: SemanticLayer[] = manifest.activeSemanticScope.activeLayers || ["mechanism_benchmark", "boundary_control"],
): ExecutionHandoffSemanticCase[] {
    const allowed = new Set(layers);
    return manifest.cases.filter(item => allowed.has(item.layer));
}

export function executionHandoffSemanticOutputTag(manifest: ExecutionHandoffSemanticManifest): string {
    return manifest.activeSemanticScope.outputTag || manifest.activeSemanticScope.name;
}

export function normalizeSemanticFactors(factors: ExecutionHandoffSemanticFactors): string {
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
