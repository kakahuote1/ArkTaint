import * as fs from "fs";
import { Scene } from "../../../../arkanalyzer/out/src/Scene";
import { Pag } from "../../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import { ArkMethod } from "../../../../arkanalyzer/out/src/core/model/ArkMethod";
import { TaintFlow } from "../../kernel/TaintFlow";
import type {
    BridgeDecl,
    EnqueueFactDecl,
    FlowDecl,
    PropagationContributionBatch,
    SyntheticEdgeDecl,
} from "../../kernel/contracts/EnginePluginActions";
import { createEmptyPropagationContributionBatch } from "../../kernel/contracts/EnginePluginActions";
import {
    CallEdgeEvent,
    MethodReachedEvent,
    TaintFlowEvent,
} from "../../kernel/contracts/EnginePluginEvents";
import {
    AnalysisStats,
    DetectionApi,
    DetectionContext,
    DetectionInput,
    EnginePlugin,
    EnginePluginConfigSnapshot,
    EntryApi,
    EntryDiscoverer,
    EntryPlan,
    FinishApi,
    PropagationApi,
    PropagationInput,
    PropagationOutput,
    Propagator,
    ResultApi,
    SinkDetectionRunner,
    StartApi,
} from "./EnginePlugin";
import {
    SanitizerRule,
    SinkRule,
    SourceRule,
    TransferRule,
} from "../../rules/RuleSchema";

interface EntryPhaseAudit {
    defaultEntryCount: number;
    addedEntryCount: number;
    replacePluginName?: string;
}

interface PropagationPhaseAudit {
    callEdgeObserverCount: number;
    taintFlowObserverCount: number;
    methodReachedObserverCount: number;
    addedFlowCount: number;
    addedBridgeCount: number;
    addedSyntheticEdgeCount: number;
    enqueuedFactCount: number;
    replacePluginName?: string;
}

interface DetectionPhaseAudit {
    addedChecks: string[];
    replacePluginName?: string;
}

interface ResultPhaseAudit {
    filterCount: number;
    transformCount: number;
    addedFindingCount: number;
}

export interface EnginePluginAuditSnapshot {
    loadedPluginNames: string[];
    dryRun: boolean;
    optionOverrides: Record<string, unknown>;
    start: {
        sourceRulesAdded: number;
        sinkRulesAdded: number;
        transferRulesAdded: number;
        sanitizerRulesAdded: number;
    };
    lastEntryPhase?: EntryPhaseAudit;
    lastPropagationPhase?: PropagationPhaseAudit;
    lastDetectionPhase?: DetectionPhaseAudit;
    lastResultPhase?: ResultPhaseAudit;
}

export interface EnginePluginRuntimeOptions {
    scene: Scene;
    config: EnginePluginConfigSnapshot;
    dryRun?: boolean;
}

export interface ActivePropagationHooks {
    onCallEdge(event: CallEdgeEvent): PropagationContributionBatch;
    onTaintFlow(event: TaintFlowEvent): PropagationContributionBatch;
    onMethodReached(event: MethodReachedEvent): PropagationContributionBatch;
    run(input: PropagationInput, fallback: Propagator): PropagationOutput;
}

export class EnginePluginRuntime {
    private readonly dryRun: boolean;
    private readonly plugins: EnginePlugin[];
    private readonly scene: Scene;
    private readonly config: EnginePluginConfigSnapshot;
    private readonly additionalSourceRules: SourceRule[] = [];
    private readonly additionalSinkRules: SinkRule[] = [];
    private readonly additionalTransferRules: TransferRule[] = [];
    private readonly additionalSanitizerRules: SanitizerRule[] = [];
    private readonly optionOverrides = new Map<string, unknown>();
    private readonly audit: EnginePluginAuditSnapshot;
    private currentPropagationCollector?: PropagationContributionBatch;
    private currentPropagationPag?: Pag;

    constructor(plugins: EnginePlugin[], options: EnginePluginRuntimeOptions) {
        this.plugins = plugins;
        this.scene = options.scene;
        this.config = options.config;
        this.dryRun = options.dryRun === true;
        this.audit = {
            loadedPluginNames: plugins.map(plugin => plugin.name),
            dryRun: this.dryRun,
            optionOverrides: {},
            start: {
                sourceRulesAdded: 0,
                sinkRulesAdded: 0,
                transferRulesAdded: 0,
                sanitizerRulesAdded: 0,
            },
        };
        this.runStartHooks();
    }

    listPluginNames(): string[] {
        return this.plugins.map(plugin => plugin.name);
    }

    hasPlugins(): boolean {
        return this.plugins.length > 0;
    }

    getAdditionalSourceRules(): SourceRule[] {
        return this.dryRun ? [] : [...this.additionalSourceRules];
    }

    getAdditionalSinkRules(): SinkRule[] {
        return this.dryRun ? [] : [...this.additionalSinkRules];
    }

    getAdditionalTransferRules(): TransferRule[] {
        return this.dryRun ? [] : [...this.additionalTransferRules];
    }

    getAdditionalSanitizerRules(): SanitizerRule[] {
        return this.dryRun ? [] : [...this.additionalSanitizerRules];
    }

    getOptionOverrides(): ReadonlyMap<string, unknown> {
        return this.optionOverrides;
    }

    getAuditSnapshot(): EnginePluginAuditSnapshot {
        return {
            ...this.audit,
            optionOverrides: { ...this.audit.optionOverrides },
            loadedPluginNames: [...this.audit.loadedPluginNames],
            start: { ...this.audit.start },
            lastEntryPhase: this.audit.lastEntryPhase ? { ...this.audit.lastEntryPhase } : undefined,
            lastPropagationPhase: this.audit.lastPropagationPhase ? { ...this.audit.lastPropagationPhase } : undefined,
            lastDetectionPhase: this.audit.lastDetectionPhase
                ? {
                    ...this.audit.lastDetectionPhase,
                    addedChecks: [...this.audit.lastDetectionPhase.addedChecks],
                }
                : undefined,
            lastResultPhase: this.audit.lastResultPhase ? { ...this.audit.lastResultPhase } : undefined,
        };
    }

    resolveEntries(defaultEntries: ArkMethod[], fallback: EntryDiscoverer): ArkMethod[] {
        if (this.plugins.length === 0) {
            return [...defaultEntries];
        }

        const addedEntries = new Map<string, ArkMethod>();
        let replacePluginName: string | undefined;
        let replaceFn: ((scene: Scene, fallback: EntryDiscoverer) => EntryPlan) | undefined;

        const api: EntryApi = {
            getScene: () => this.scene,
            getDefaultEntries: () => [...defaultEntries],
            addEntry: (entry) => {
                const signature = entry?.getSignature?.()?.toString?.();
                if (!signature || addedEntries.has(signature)) return;
                addedEntries.set(signature, entry);
            },
            replace: (fn) => {
                const owner = this.findCurrentPluginName();
                if (replaceFn) {
                    throw new Error(
                        `engine plugin entry replace conflict: ${replacePluginName} vs ${owner}`,
                    );
                }
                replaceFn = fn;
                replacePluginName = owner;
            },
        };

        for (const plugin of this.plugins) {
            this.currentPluginName = plugin.name;
            plugin.onEntry?.(api);
        }
        this.currentPluginName = undefined;

        this.audit.lastEntryPhase = {
            defaultEntryCount: defaultEntries.length,
            addedEntryCount: addedEntries.size,
            replacePluginName,
        };

        if (this.dryRun) {
            return [...defaultEntries];
        }
        const baseEntries = replaceFn
            ? replaceFn(this.scene, fallback).orderedMethods
            : [...defaultEntries];
        return this.mergeEntries(baseEntries, [...addedEntries.values()]);
    }

    beginPropagation(options: { pag: Pag }): ActivePropagationHooks {
        this.currentPropagationPag = options.pag;
        const callEdgeObservers: Array<(event: CallEdgeEvent) => void> = [];
        const taintFlowObservers: Array<(event: TaintFlowEvent) => void> = [];
        const methodReachedObservers: Array<(event: MethodReachedEvent) => void> = [];
        let replacePluginName: string | undefined;
        let replaceFn: ((input: PropagationInput, fallback: Propagator) => PropagationOutput) | undefined;

        const api: PropagationApi = {
            getScene: () => this.scene,
            getPag: () => {
                if (!this.currentPropagationPag) {
                    throw new Error("engine plugin propagation API cannot access PAG before propagation starts");
                }
                return this.currentPropagationPag;
            },
            onCallEdge: cb => callEdgeObservers.push(cb),
            onTaintFlow: cb => taintFlowObservers.push(cb),
            onMethodReached: cb => methodReachedObservers.push(cb),
            addFlow: decl => {
                this.requireActivePropagationCollector().flows.push(decl);
            },
            addBridge: decl => {
                this.requireActivePropagationCollector().bridges.push(decl);
            },
            addSyntheticEdge: decl => {
                this.requireActivePropagationCollector().syntheticEdges.push(decl);
            },
            enqueueFact: decl => {
                this.requireActivePropagationCollector().facts.push(decl);
            },
            replace: fn => {
                const owner = this.findCurrentPluginName();
                if (replaceFn) {
                    throw new Error(
                        `engine plugin propagation replace conflict: ${replacePluginName} vs ${owner}`,
                    );
                }
                replaceFn = fn;
                replacePluginName = owner;
            },
        };

        for (const plugin of this.plugins) {
            this.currentPluginName = plugin.name;
            plugin.onPropagation?.(api);
        }
        this.currentPluginName = undefined;

        this.audit.lastPropagationPhase = {
            callEdgeObserverCount: callEdgeObservers.length,
            taintFlowObserverCount: taintFlowObservers.length,
            methodReachedObserverCount: methodReachedObservers.length,
            addedFlowCount: 0,
            addedBridgeCount: 0,
            addedSyntheticEdgeCount: 0,
            enqueuedFactCount: 0,
            replacePluginName,
        };

        return {
            onCallEdge: (event) => {
                return this.collectPropagationContributions(callEdgeObservers, event);
            },
            onTaintFlow: (event) => {
                return this.collectPropagationContributions(taintFlowObservers, event);
            },
            onMethodReached: (event) => {
                return this.collectPropagationContributions(methodReachedObservers, event);
            },
            run: (input, fallback) => {
                if (this.dryRun || !replaceFn) {
                    return fallback.run(input);
                }
                return replaceFn(input, fallback);
            },
        };
    }

    runDetection(
        input: DetectionInput,
        ctx: DetectionContext,
        fallback: SinkDetectionRunner,
    ): TaintFlow[] {
        if (this.plugins.length === 0) {
            return fallback.run(input);
        }

        const checks: Array<{ name: string; run: (ctx: DetectionContext) => TaintFlow[] }> = [];
        let replacePluginName: string | undefined;
        let replaceFn: ((input: DetectionInput, fallback: SinkDetectionRunner) => TaintFlow[]) | undefined;

        const api: DetectionApi = {
            getTaintFacts: () => ctx.getTaintFacts(),
            addCheck: (name, fn) => {
                checks.push({ name, run: fn });
            },
            replace: (fn) => {
                const owner = this.findCurrentPluginName();
                if (replaceFn) {
                    throw new Error(
                        `engine plugin detection replace conflict: ${replacePluginName} vs ${owner}`,
                    );
                }
                replaceFn = fn;
                replacePluginName = owner;
            },
        };

        for (const plugin of this.plugins) {
            this.currentPluginName = plugin.name;
            plugin.onDetection?.(api);
        }
        this.currentPluginName = undefined;

        this.audit.lastDetectionPhase = {
            addedChecks: checks.map(check => check.name),
            replacePluginName,
        };

        const findings = this.dryRun || !replaceFn
            ? fallback.run(input)
            : replaceFn(input, fallback);
        if (this.dryRun) {
            return findings;
        }
        const out = [...findings];
        for (const check of checks) {
            out.push(...(check.run(ctx) || []));
        }
        return out;
    }

    applyResultHooks(findings: TaintFlow[]): TaintFlow[] {
        if (this.plugins.length === 0) {
            return findings;
        }

        const filters: Array<(finding: TaintFlow) => TaintFlow | null> = [];
        const transforms: Array<(findings: TaintFlow[]) => TaintFlow[]> = [];
        const addedFindings: TaintFlow[] = [];

        const api: ResultApi = {
            getFindings: () => [...findings, ...addedFindings],
            filter: (fn) => filters.push(fn),
            addFinding: (finding) => addedFindings.push(finding),
            transform: (fn) => transforms.push(fn),
        };

        for (const plugin of this.plugins) {
            this.currentPluginName = plugin.name;
            plugin.onResult?.(api);
        }
        this.currentPluginName = undefined;

        this.audit.lastResultPhase = {
            filterCount: filters.length,
            transformCount: transforms.length,
            addedFindingCount: addedFindings.length,
        };

        if (this.dryRun) {
            return findings;
        }

        let out = [...findings];
        for (const filter of filters) {
            out = out.map(filter).filter((item): item is TaintFlow => !!item);
        }
        out.push(...addedFindings);
        for (const transform of transforms) {
            out = transform([...out]) || [];
        }
        return out;
    }

    finish(stats: AnalysisStats, findings: TaintFlow[]): void {
        if (this.plugins.length === 0) {
            return;
        }
        const api: FinishApi = {
            getStats: () => ({ ...stats, loadedPluginNames: [...stats.loadedPluginNames], loadedSemanticPackIds: [...stats.loadedSemanticPackIds] }),
            getFindings: () => [...findings],
            exportReport: (format, outputPath) => {
                if (format === "json") {
                    fs.writeFileSync(outputPath, JSON.stringify({
                        stats,
                        findings: findings.map(flow => ({
                            source: flow.source,
                            sink: flow.sink.toString(),
                            sourceRuleId: flow.sourceRuleId,
                            sinkRuleId: flow.sinkRuleId,
                            transferRuleIds: flow.transferRuleIds || [],
                        })),
                    }, null, 2), "utf-8");
                    return;
                }
                const lines = [
                    "source,sink,sourceRuleId,sinkRuleId,transferRuleIds",
                    ...findings.map(flow => [
                        csvEscape(flow.source),
                        csvEscape(flow.sink.toString()),
                        csvEscape(flow.sourceRuleId || ""),
                        csvEscape(flow.sinkRuleId || ""),
                        csvEscape((flow.transferRuleIds || []).join("|")),
                    ].join(",")),
                ];
                fs.writeFileSync(outputPath, `${lines.join("\n")}\n`, "utf-8");
            },
        };
        for (const plugin of this.plugins) {
            plugin.onFinish?.(api);
        }
    }

    private collectPropagationContributions<TEvent>(
        observers: Array<(event: TEvent) => void>,
        event: TEvent,
    ): PropagationContributionBatch {
        if (observers.length === 0) {
            return createEmptyPropagationContributionBatch();
        }
        const batch = createEmptyPropagationContributionBatch();
        this.currentPropagationCollector = batch;
        try {
            for (const observer of observers) {
                observer(event);
            }
        } finally {
            this.currentPropagationCollector = undefined;
        }
        if (this.audit.lastPropagationPhase) {
            this.audit.lastPropagationPhase.addedFlowCount += batch.flows.length;
            this.audit.lastPropagationPhase.addedBridgeCount += batch.bridges.length;
            this.audit.lastPropagationPhase.addedSyntheticEdgeCount += batch.syntheticEdges.length;
            this.audit.lastPropagationPhase.enqueuedFactCount += batch.facts.length;
        }
        return batch;
    }

    private requireActivePropagationCollector(): PropagationContributionBatch {
        if (!this.currentPropagationCollector) {
            throw new Error("engine plugin propagation mutations are only allowed inside propagation event callbacks");
        }
        return this.currentPropagationCollector;
    }

    private currentPluginName?: string;

    private findCurrentPluginName(): string {
        return this.currentPluginName || "@unknown_plugin";
    }

    private mergeEntries(base: ArkMethod[], additions: ArkMethod[]): ArkMethod[] {
        const dedup = new Map<string, ArkMethod>();
        for (const method of [...base, ...additions]) {
            const signature = method?.getSignature?.()?.toString?.();
            if (!signature || dedup.has(signature)) continue;
            dedup.set(signature, method);
        }
        return [...dedup.values()];
    }

    private runStartHooks(): void {
        const api: StartApi = {
            getConfig: () => ({ ...this.config, isolatedPluginNames: [...this.config.isolatedPluginNames], semanticPackIds: [...this.config.semanticPackIds] }),
            getScene: () => this.scene,
            addRule: (kind, rule) => {
                this.pushRule(kind, rule);
            },
            addSourceRule: rule => this.pushRule("source", rule),
            addSinkRule: rule => this.pushRule("sink", rule),
            addTransferRule: rule => this.pushRule("transfer", rule),
            addSanitizerRule: rule => this.pushRule("sanitizer", rule),
            setOption: (key, value) => {
                this.optionOverrides.set(key, value);
                this.audit.optionOverrides[key] = value;
            },
        };

        for (const plugin of this.plugins) {
            this.currentPluginName = plugin.name;
            plugin.onStart?.(api);
        }
        this.currentPluginName = undefined;
    }

    private pushRule(
        kind: "source" | "sink" | "transfer" | "sanitizer",
        rule: SourceRule | SinkRule | TransferRule | SanitizerRule,
    ): void {
        switch (kind) {
            case "source":
                this.additionalSourceRules.push(rule as SourceRule);
                this.audit.start.sourceRulesAdded++;
                break;
            case "sink":
                this.additionalSinkRules.push(rule as SinkRule);
                this.audit.start.sinkRulesAdded++;
                break;
            case "transfer":
                this.additionalTransferRules.push(rule as TransferRule);
                this.audit.start.transferRulesAdded++;
                break;
            case "sanitizer":
                this.additionalSanitizerRules.push(rule as SanitizerRule);
                this.audit.start.sanitizerRulesAdded++;
                break;
        }
    }
}

function csvEscape(value: string): string {
    if (/[",\n]/.test(value)) {
        return `"${value.replace(/"/g, "\"\"")}"`;
    }
    return value;
}

export function createEnginePluginRuntime(
    plugins: EnginePlugin[],
    options: EnginePluginRuntimeOptions,
): EnginePluginRuntime {
    return new EnginePluginRuntime(plugins, options);
}
