import { CallGraph } from "../../../../arkanalyzer/lib/callgraph/model/CallGraph";
import { Pag } from "../../../../arkanalyzer/lib/callgraph/pointerAnalysis/Pag";
import { Scene } from "../../../../arkanalyzer/lib/Scene";
import { ArkMethod } from "../../../../arkanalyzer/lib/core/model/ArkMethod";
import type {
    BridgeDecl,
    EnqueueFactDecl,
    FlowDecl,
    SyntheticEdgeDecl,
} from "../../kernel/contracts/EnginePluginActions";
import type {
    CallEdgeEvent,
    MethodReachedEvent,
    TaintFlowEvent,
} from "../../kernel/contracts/EnginePluginEvents";
import type { TaintFact } from "../../kernel/model/TaintFact";
import type { TaintFlow } from "../../kernel/model/TaintFlow";
import type { TaintTracker } from "../../kernel/model/TaintTracker";
import type { WorklistSolverDeps } from "../../kernel/propagation/WorklistSolver";
import type {
    SanitizerRule,
    SinkRule,
    SourceRule,
    TransferRule,
} from "../../rules/RuleSchema";

export type EnginePluginRuleKind = "source" | "sink" | "transfer" | "sanitizer";

export interface EnginePluginConfigSnapshot {
    k: number;
    verbose: boolean;
    dryRun: boolean;
    isolatedPluginNames: string[];
    moduleIds: string[];
}

export interface EntryPlan {
    orderedMethods: ArkMethod[];
}

export interface EntryDiscoverer {
    discover(scene: Scene): EntryPlan;
}

export interface StartApi {
    getConfig(): Readonly<EnginePluginConfigSnapshot>;
    getScene(): Scene;
    addRule(kind: EnginePluginRuleKind, rule: SourceRule | SinkRule | TransferRule | SanitizerRule): void;
    addSourceRule(rule: SourceRule): void;
    addSinkRule(rule: SinkRule): void;
    addTransferRule(rule: TransferRule): void;
    addSanitizerRule(rule: SanitizerRule): void;
    setOption(key: string, value: unknown): void;
}

export interface EntryApi {
    getScene(): Scene;
    getDefaultEntries(): readonly ArkMethod[];
    addEntry(entry: ArkMethod): void;
    replace(fn: (scene: Scene, fallback: EntryDiscoverer) => EntryPlan): void;
}

export interface PropagationInput {
    worklist: TaintFact[];
    visited: Set<string>;
    deps: WorklistSolverDeps;
}

export interface PropagationOutput {
    visitedCount: number;
}

export interface Propagator {
    run(input: PropagationInput): PropagationOutput;
}

export interface PropagationApi {
    getScene(): Scene;
    getPag(): Pag;
    onCallEdge(cb: (event: CallEdgeEvent) => void): void;
    onTaintFlow(cb: (event: TaintFlowEvent) => void): void;
    onMethodReached(cb: (event: MethodReachedEvent) => void): void;
    addFlow(decl: FlowDecl): void;
    addBridge(decl: BridgeDecl): void;
    addSyntheticEdge(decl: SyntheticEdgeDecl): void;
    enqueueFact(decl: EnqueueFactDecl): void;
    replace(fn: (input: PropagationInput, fallback: Propagator) => PropagationOutput): void;
}

export interface DetectionContext {
    scene: Scene;
    pag: Pag;
    cg: CallGraph;
    tracker: TaintTracker;
    getTaintFacts(): ReadonlyMap<number, readonly TaintFact[]>;
    detectSinks(
        signature: string,
        options?: {
            targetEndpoint?: string;
            targetPath?: string[];
        }
    ): TaintFlow[];
}

export interface DetectionInput {
    sinkRules: readonly SinkRule[];
    sanitizerRules: readonly SanitizerRule[];
    stopOnFirstFlow?: boolean;
    maxFlowsPerEntry?: number;
}

export interface SinkDetectionRunner {
    run(input: DetectionInput): TaintFlow[];
}

export interface DetectionApi {
    getTaintFacts(): ReadonlyMap<number, readonly TaintFact[]>;
    addCheck(name: string, fn: (ctx: DetectionContext) => TaintFlow[]): void;
    replace(fn: (input: DetectionInput, fallback: SinkDetectionRunner) => TaintFlow[]): void;
}

export interface ResultApi {
    getFindings(): readonly TaintFlow[];
    filter(fn: (finding: TaintFlow) => TaintFlow | null): void;
    addFinding(finding: TaintFlow): void;
    transform(fn: (findings: TaintFlow[]) => TaintFlow[]): void;
}

export interface AnalysisStats {
    findingCount: number;
    taintedFactCount: number;
    reachableMethodCount?: number;
    elapsedMs?: number;
    sourceDir?: string;
    loadedModuleIds: string[];
    loadedPluginNames: string[];
}

export interface FinishApi {
    getStats(): AnalysisStats;
    getFindings(): readonly TaintFlow[];
    exportReport(format: "json" | "csv", outputPath: string): void;
}

export interface EnginePlugin {
    readonly name: string;
    readonly description?: string;
    readonly enabled?: boolean;
    onStart?(api: StartApi): void;
    onEntry?(api: EntryApi): void;
    onPropagation?(api: PropagationApi): void;
    onDetection?(api: DetectionApi): void;
    onResult?(api: ResultApi): void;
    onFinish?(api: FinishApi): void;
}

export function defineEnginePlugin<T extends EnginePlugin>(plugin: T): T {
    return plugin;
}
