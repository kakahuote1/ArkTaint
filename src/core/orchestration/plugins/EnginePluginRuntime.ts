import * as fs from "fs";
import { Scene } from "../../../../arkanalyzer/lib/Scene";
import { Pag } from "../../../../arkanalyzer/lib/callgraph/pointerAnalysis/Pag";
import { ArkMethod } from "../../../../arkanalyzer/lib/core/model/ArkMethod";
import { TaintFlow } from "../../kernel/model/TaintFlow";
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
import {
    extractErrorLocation,
    getExtensionSourceModulePath,
    preferExtensionSourceLocation,
} from "../ExtensionLoaderUtils";

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

interface EnginePluginFailureEvent {
    pluginName: string;
    phase: string;
    message: string;
    code?: string;
    advice?: string;
    path?: string;
    line?: number;
    column?: number;
    stackExcerpt?: string;
    userMessage: string;
}

export interface EnginePluginAuditEntry {
    pluginName: string;
    description?: string;
    sourcePath?: string;
    startHookCalls: number;
    entryHookCalls: number;
    propagationHookCalls: number;
    detectionHookCalls: number;
    resultHookCalls: number;
    finishHookCalls: number;
    sourceRulesAdded: number;
    sinkRulesAdded: number;
    transferRulesAdded: number;
    sanitizerRulesAdded: number;
    optionOverrideCount: number;
    entryAdds: number;
    entryReplaceUsed: boolean;
    callEdgeObserverCount: number;
    taintFlowObserverCount: number;
    methodReachedObserverCount: number;
    propagationReplaceUsed: boolean;
    addedFlowCount: number;
    addedBridgeCount: number;
    addedSyntheticEdgeCount: number;
    enqueuedFactCount: number;
    detectionCheckNames: string[];
    detectionCheckRunCount: number;
    detectionReplaceUsed: boolean;
    resultFilterCount: number;
    resultTransformCount: number;
    resultAddedFindingCount: number;
}

class EnginePluginDiagnosticError extends Error {
    readonly diagnosticCode: string;
    readonly diagnosticAdvice: string;

    constructor(message: string, diagnosticCode: string, diagnosticAdvice: string) {
        super(message);
        this.name = "EnginePluginDiagnosticError";
        this.diagnosticCode = diagnosticCode;
        this.diagnosticAdvice = diagnosticAdvice;
    }
}

function normalizePhaseCode(value: string): string {
    return value
        .replace(/[^A-Za-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
        .toUpperCase();
}

function classifyPluginFailure(
    phase: string,
    error: unknown,
): { code: string; advice: string } {
    if (error instanceof EnginePluginDiagnosticError) {
        return {
            code: error.diagnosticCode,
            advice: error.diagnosticAdvice,
        };
    }
    const phaseCode = normalizePhaseCode(phase);
    return {
        code: `PLUGIN_${phaseCode}_THROW`,
        advice: "This plugin threw directly in this phase. Check nearby code for null access, invalid assumptions, or helper return values.",
    };
}

export interface EnginePluginAuditSnapshot {
    loadedPluginNames: string[];
    failedPluginNames: string[];
    failureEvents: EnginePluginFailureEvent[];
    dryRun: boolean;
    optionOverrides: Record<string, unknown>;
    pluginStats: Record<string, EnginePluginAuditEntry>;
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
    private readonly failedPluginNames = new Set<string>();
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
            failedPluginNames: [],
            failureEvents: [],
            dryRun: this.dryRun,
            optionOverrides: {},
            pluginStats: {},
            start: {
                sourceRulesAdded: 0,
                sinkRulesAdded: 0,
                transferRulesAdded: 0,
                sanitizerRulesAdded: 0,
            },
        };
        for (const plugin of plugins) {
            this.audit.pluginStats[plugin.name] = {
                pluginName: plugin.name,
                description: plugin.description,
                sourcePath: getExtensionSourceModulePath(plugin),
                startHookCalls: 0,
                entryHookCalls: 0,
                propagationHookCalls: 0,
                detectionHookCalls: 0,
                resultHookCalls: 0,
                finishHookCalls: 0,
                sourceRulesAdded: 0,
                sinkRulesAdded: 0,
                transferRulesAdded: 0,
                sanitizerRulesAdded: 0,
                optionOverrideCount: 0,
                entryAdds: 0,
                entryReplaceUsed: false,
                callEdgeObserverCount: 0,
                taintFlowObserverCount: 0,
                methodReachedObserverCount: 0,
                propagationReplaceUsed: false,
                addedFlowCount: 0,
                addedBridgeCount: 0,
                addedSyntheticEdgeCount: 0,
                enqueuedFactCount: 0,
                detectionCheckNames: [],
                detectionCheckRunCount: 0,
                detectionReplaceUsed: false,
                resultFilterCount: 0,
                resultTransformCount: 0,
                resultAddedFindingCount: 0,
            };
        }
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
            failedPluginNames: [...this.audit.failedPluginNames],
            failureEvents: this.audit.failureEvents.map(event => ({ ...event })),
            pluginStats: Object.fromEntries(
                Object.entries(this.audit.pluginStats).map(([pluginName, stats]) => [
                    pluginName,
                    {
                        ...stats,
                        detectionCheckNames: [...stats.detectionCheckNames],
                    },
                ]),
            ),
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

        for (const plugin of this.plugins) {
            if (this.failedPluginNames.has(plugin.name)) continue;
            const stagedEntries = new Map<string, ArkMethod>();
            let stagedReplaceFn: ((scene: Scene, fallback: EntryDiscoverer) => EntryPlan) | undefined;
            this.currentPluginName = plugin.name;
            this.requirePluginStats(plugin.name).entryHookCalls++;
            const api: EntryApi = {
                getScene: () => this.scene,
                getDefaultEntries: () => [...defaultEntries],
                addEntry: (entry) => {
                    const signature = entry?.getSignature?.()?.toString?.();
                    if (!signature || stagedEntries.has(signature) || addedEntries.has(signature)) return;
                    stagedEntries.set(signature, entry);
                    this.requirePluginStats(plugin.name).entryAdds++;
                },
                replace: (fn) => {
                    if (stagedReplaceFn) {
                        throw new Error(
                            `engine plugin entry replace conflict within plugin: ${plugin.name}`,
                        );
                    }
                    stagedReplaceFn = fn;
                    this.requirePluginStats(plugin.name).entryReplaceUsed = true;
                },
            };
            try {
                plugin.onEntry?.(api);
            } catch (error) {
                this.markPluginFailed(plugin.name, "onEntry", error);
                continue;
            } finally {
                this.currentPluginName = undefined;
            }
            for (const [signature, entry] of stagedEntries.entries()) {
                if (!addedEntries.has(signature)) {
                    addedEntries.set(signature, entry);
                }
            }
            if (stagedReplaceFn) {
                if (replaceFn) {
                    throw new Error(
                        `engine plugin entry replace conflict: ${replacePluginName} vs ${plugin.name}`,
                    );
                }
                replaceFn = stagedReplaceFn;
                replacePluginName = plugin.name;
            }
        }

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
        const callEdgeObservers: Array<{ pluginName: string; observer: (event: CallEdgeEvent) => void }> = [];
        const taintFlowObservers: Array<{ pluginName: string; observer: (event: TaintFlowEvent) => void }> = [];
        const methodReachedObservers: Array<{ pluginName: string; observer: (event: MethodReachedEvent) => void }> = [];
        let replacePluginName: string | undefined;
        let replaceFn: ((input: PropagationInput, fallback: Propagator) => PropagationOutput) | undefined;

        for (const plugin of this.plugins) {
            if (this.failedPluginNames.has(plugin.name)) continue;
            const stagedCallEdgeObservers: Array<(event: CallEdgeEvent) => void> = [];
            const stagedTaintFlowObservers: Array<(event: TaintFlowEvent) => void> = [];
            const stagedMethodReachedObservers: Array<(event: MethodReachedEvent) => void> = [];
            let stagedReplaceFn: ((input: PropagationInput, fallback: Propagator) => PropagationOutput) | undefined;
            this.currentPluginName = plugin.name;
            this.requirePluginStats(plugin.name).propagationHookCalls++;
            const api: PropagationApi = {
                getScene: () => this.scene,
                getPag: () => {
                    if (!this.currentPropagationPag) {
                        throw new Error("engine plugin propagation API cannot access PAG before propagation starts");
                    }
                    return this.currentPropagationPag;
                },
                onCallEdge: cb => {
                    stagedCallEdgeObservers.push(cb);
                    this.requirePluginStats(plugin.name).callEdgeObserverCount++;
                },
                onTaintFlow: cb => {
                    stagedTaintFlowObservers.push(cb);
                    this.requirePluginStats(plugin.name).taintFlowObserverCount++;
                },
                onMethodReached: cb => {
                    stagedMethodReachedObservers.push(cb);
                    this.requirePluginStats(plugin.name).methodReachedObserverCount++;
                },
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
                    if (stagedReplaceFn) {
                        throw new Error(`engine plugin propagation replace conflict within plugin: ${plugin.name}`);
                    }
                    stagedReplaceFn = fn;
                    this.requirePluginStats(plugin.name).propagationReplaceUsed = true;
                },
            };
            try {
                plugin.onPropagation?.(api);
            } catch (error) {
                this.markPluginFailed(plugin.name, "onPropagation", error);
                continue;
            } finally {
                this.currentPluginName = undefined;
            }
            callEdgeObservers.push(...stagedCallEdgeObservers.map(observer => ({ pluginName: plugin.name, observer })));
            taintFlowObservers.push(...stagedTaintFlowObservers.map(observer => ({ pluginName: plugin.name, observer })));
            methodReachedObservers.push(...stagedMethodReachedObservers.map(observer => ({ pluginName: plugin.name, observer })));
            if (stagedReplaceFn) {
                if (replaceFn) {
                    throw new Error(
                        `engine plugin propagation replace conflict: ${replacePluginName} vs ${plugin.name}`,
                    );
                }
                replaceFn = stagedReplaceFn;
                replacePluginName = plugin.name;
            }
        }

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

        const checks: Array<{ pluginName: string; name: string; run: (ctx: DetectionContext) => TaintFlow[] }> = [];
        let replacePluginName: string | undefined;
        let replaceFn: ((input: DetectionInput, fallback: SinkDetectionRunner) => TaintFlow[]) | undefined;

        for (const plugin of this.plugins) {
            if (this.failedPluginNames.has(plugin.name)) continue;
            const stagedChecks: Array<{ name: string; run: (ctx: DetectionContext) => TaintFlow[] }> = [];
            let stagedReplaceFn: ((input: DetectionInput, fallback: SinkDetectionRunner) => TaintFlow[]) | undefined;
            this.currentPluginName = plugin.name;
            this.requirePluginStats(plugin.name).detectionHookCalls++;
            const api: DetectionApi = {
                getTaintFacts: () => ctx.getTaintFacts(),
                addCheck: (name, fn) => {
                    stagedChecks.push({ name, run: fn });
                    this.requirePluginStats(plugin.name).detectionCheckNames.push(name);
                },
                replace: (fn) => {
                    if (stagedReplaceFn) {
                        throw new Error(`engine plugin detection replace conflict within plugin: ${plugin.name}`);
                    }
                    stagedReplaceFn = fn;
                    this.requirePluginStats(plugin.name).detectionReplaceUsed = true;
                },
            };
            try {
                plugin.onDetection?.(api);
            } catch (error) {
                this.markPluginFailed(plugin.name, "onDetection", error);
                continue;
            } finally {
                this.currentPluginName = undefined;
            }
            checks.push(...stagedChecks.map(check => ({ pluginName: plugin.name, ...check })));
            if (stagedReplaceFn) {
                if (replaceFn) {
                    throw new Error(
                        `engine plugin detection replace conflict: ${replacePluginName} vs ${plugin.name}`,
                    );
                }
                replaceFn = stagedReplaceFn;
                replacePluginName = plugin.name;
            }
        }

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
            if (this.failedPluginNames.has(check.pluginName)) continue;
            try {
                this.requirePluginStats(check.pluginName).detectionCheckRunCount++;
                out.push(...(check.run(ctx) || []));
            } catch (error) {
                this.markPluginFailed(check.pluginName, `detection.check:${check.name}`, error);
            }
        }
        return out;
    }

    applyResultHooks(findings: TaintFlow[]): TaintFlow[] {
        if (this.plugins.length === 0) {
            return findings;
        }

        const filters: Array<{ pluginName: string; filter: (finding: TaintFlow) => TaintFlow | null }> = [];
        const transforms: Array<{ pluginName: string; transform: (findings: TaintFlow[]) => TaintFlow[] }> = [];
        const addedFindings: TaintFlow[] = [];

        for (const plugin of this.plugins) {
            if (this.failedPluginNames.has(plugin.name)) continue;
            const stagedFilters: Array<(finding: TaintFlow) => TaintFlow | null> = [];
            const stagedTransforms: Array<(findings: TaintFlow[]) => TaintFlow[]> = [];
            const stagedFindings: TaintFlow[] = [];
            this.currentPluginName = plugin.name;
            this.requirePluginStats(plugin.name).resultHookCalls++;
            const api: ResultApi = {
                getFindings: () => [...findings, ...addedFindings, ...stagedFindings],
                filter: (fn) => {
                    stagedFilters.push(fn);
                    this.requirePluginStats(plugin.name).resultFilterCount++;
                },
                addFinding: (finding) => {
                    stagedFindings.push(finding);
                    this.requirePluginStats(plugin.name).resultAddedFindingCount++;
                },
                transform: (fn) => {
                    stagedTransforms.push(fn);
                    this.requirePluginStats(plugin.name).resultTransformCount++;
                },
            };
            try {
                plugin.onResult?.(api);
            } catch (error) {
                this.markPluginFailed(plugin.name, "onResult", error);
                continue;
            } finally {
                this.currentPluginName = undefined;
            }
            filters.push(...stagedFilters.map(filter => ({ pluginName: plugin.name, filter })));
            transforms.push(...stagedTransforms.map(transform => ({ pluginName: plugin.name, transform })));
            addedFindings.push(...stagedFindings);
        }

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
            if (this.failedPluginNames.has(filter.pluginName)) continue;
            try {
                out = out.map(filter.filter).filter((item): item is TaintFlow => !!item);
            } catch (error) {
                this.markPluginFailed(filter.pluginName, "result.filter", error);
            }
        }
        out.push(...addedFindings);
        for (const transform of transforms) {
            if (this.failedPluginNames.has(transform.pluginName)) continue;
            try {
                out = transform.transform([...out]) || [];
            } catch (error) {
                this.markPluginFailed(transform.pluginName, "result.transform", error);
            }
        }
        return out;
    }

    finish(stats: AnalysisStats, findings: TaintFlow[]): void {
        if (this.plugins.length === 0) {
            return;
        }
        const api: FinishApi = {
            getStats: () => ({ ...stats, loadedPluginNames: [...stats.loadedPluginNames], loadedModuleIds: [...stats.loadedModuleIds] }),
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
            if (this.failedPluginNames.has(plugin.name)) continue;
            try {
                this.requirePluginStats(plugin.name).finishHookCalls++;
                plugin.onFinish?.(api);
            } catch (error) {
                this.markPluginFailed(plugin.name, "onFinish", error);
            }
        }
    }

    private collectPropagationContributions<TEvent>(
        observers: Array<{ pluginName: string; observer: (event: TEvent) => void }>,
        event: TEvent,
    ): PropagationContributionBatch {
        if (observers.length === 0) {
            return createEmptyPropagationContributionBatch();
        }
        const batch = createEmptyPropagationContributionBatch();
        for (const { pluginName, observer } of observers) {
            if (this.failedPluginNames.has(pluginName)) continue;
            const staged = createEmptyPropagationContributionBatch();
            this.currentPropagationCollector = staged;
            try {
                observer(event);
                batch.flows.push(...staged.flows);
                batch.bridges.push(...staged.bridges);
                batch.syntheticEdges.push(...staged.syntheticEdges);
                batch.facts.push(...staged.facts);
                const stats = this.requirePluginStats(pluginName);
                stats.addedFlowCount += staged.flows.length;
                stats.addedBridgeCount += staged.bridges.length;
                stats.addedSyntheticEdgeCount += staged.syntheticEdges.length;
                stats.enqueuedFactCount += staged.facts.length;
            } catch (error) {
                this.markPluginFailed(pluginName, "propagation.observer", error);
            } finally {
                this.currentPropagationCollector = undefined;
            }
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
            throw new EnginePluginDiagnosticError(
                "engine plugin propagation mutations are only allowed inside propagation event callbacks",
                "PLUGIN_ON_PROPAGATION_INVALID_MUTATION_CONTEXT",
                "These APIs are only valid inside propagation callbacks. Move addFlow/addBridge/enqueueFact into onCallEdge/onTaintFlow/onMethodReached or similar callbacks.",
            );
        }
        return this.currentPropagationCollector;
    }

    private currentPluginName?: string;

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
        for (const plugin of this.plugins) {
            if (this.failedPluginNames.has(plugin.name)) continue;
            const stagedRules: Array<{
                kind: "source" | "sink" | "transfer" | "sanitizer";
                rule: SourceRule | SinkRule | TransferRule | SanitizerRule;
            }> = [];
            const stagedOptions = new Map<string, unknown>();
            this.currentPluginName = plugin.name;
            this.requirePluginStats(plugin.name).startHookCalls++;
            const api: StartApi = {
                getConfig: () => ({ ...this.config, isolatedPluginNames: [...this.config.isolatedPluginNames], moduleIds: [...this.config.moduleIds] }),
                getScene: () => this.scene,
                addRule: (kind, rule) => {
                    stagedRules.push({ kind, rule });
                },
                addSourceRule: rule => stagedRules.push({ kind: "source", rule }),
                addSinkRule: rule => stagedRules.push({ kind: "sink", rule }),
                addTransferRule: rule => stagedRules.push({ kind: "transfer", rule }),
                addSanitizerRule: rule => stagedRules.push({ kind: "sanitizer", rule }),
                setOption: (key, value) => {
                    stagedOptions.set(key, value);
                },
            };
            try {
                plugin.onStart?.(api);
            } catch (error) {
                this.markPluginFailed(plugin.name, "onStart", error);
                continue;
            } finally {
                this.currentPluginName = undefined;
            }
            for (const { kind, rule } of stagedRules) {
                this.pushRule(plugin.name, kind, rule);
            }
            for (const [key, value] of stagedOptions.entries()) {
                this.optionOverrides.set(key, value);
                this.audit.optionOverrides[key] = value;
                this.requirePluginStats(plugin.name).optionOverrideCount++;
            }
        }
    }

    private markPluginFailed(pluginName: string, phase: string, error: unknown): void {
        if (this.failedPluginNames.has(pluginName)) return;
        const message = String((error as any)?.message || error);
        const classification = classifyPluginFailure(phase, error);
        const pluginSourcePath = getExtensionSourceModulePath(
            this.plugins.find(plugin => plugin.name === pluginName),
        );
        const location = preferExtensionSourceLocation(
            extractErrorLocation(error),
            pluginSourcePath,
        );
        const locationSuffix = location.path
            ? location.line && location.column
                ? ` @ ${location.path}:${location.line}:${location.column}`
                : ` @ ${location.path}`
            : "";
        this.failedPluginNames.add(pluginName);
        this.audit.failedPluginNames = [...this.failedPluginNames.values()];
        this.audit.failureEvents.push({
            pluginName,
            phase,
            message,
            code: classification.code,
            advice: classification.advice,
            path: location.path,
            line: location.line,
            column: location.column,
            stackExcerpt: location.stackExcerpt,
            userMessage: `engine plugin ${pluginName} failed in ${phase}${locationSuffix}: ${message}`,
        });
        console.warn(
            `engine plugin ${pluginName} disabled after ${phase} failure${locationSuffix}: ${message}`,
        );
    }

    private pushRule(
        pluginName: string,
        kind: "source" | "sink" | "transfer" | "sanitizer",
        rule: SourceRule | SinkRule | TransferRule | SanitizerRule,
    ): void {
        switch (kind) {
            case "source":
                this.additionalSourceRules.push(rule as SourceRule);
                this.audit.start.sourceRulesAdded++;
                this.requirePluginStats(pluginName).sourceRulesAdded++;
                break;
            case "sink":
                this.additionalSinkRules.push(rule as SinkRule);
                this.audit.start.sinkRulesAdded++;
                this.requirePluginStats(pluginName).sinkRulesAdded++;
                break;
            case "transfer":
                this.additionalTransferRules.push(rule as TransferRule);
                this.audit.start.transferRulesAdded++;
                this.requirePluginStats(pluginName).transferRulesAdded++;
                break;
            case "sanitizer":
                this.additionalSanitizerRules.push(rule as SanitizerRule);
                this.audit.start.sanitizerRulesAdded++;
                this.requirePluginStats(pluginName).sanitizerRulesAdded++;
                break;
        }
    }

    private requirePluginStats(pluginName: string): EnginePluginAuditEntry {
        const stats = this.audit.pluginStats[pluginName];
        if (!stats) {
            throw new Error(`missing plugin audit stats for ${pluginName}`);
        }
        return stats;
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
