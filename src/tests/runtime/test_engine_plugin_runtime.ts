import * as path from "path";
import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { Pag } from "../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import { TaintPropagationEngine } from "../../core/orchestration/TaintPropagationEngine";
import type { TaintEngineOptions } from "../../core/orchestration/TaintPropagationEngine";
import { TaintFlow } from "../../core/kernel/model/TaintFlow";
import { loadEnginePlugins } from "../../core/orchestration/plugins/EnginePluginLoader";
import { defineEnginePlugin } from "../../core/orchestration/plugins/EnginePlugin";
import { buildTestScene } from "../helpers/TestSceneBuilder";
import { createAssetIdentityIndex } from "../../core/assets/schema";
import { createCanonicalApiRegistry } from "../../core/api/identity";
import { projectApiEffectAssetFromMethod } from "../helpers/ApiEffectTestAssets";
import type { SourceRule, SinkRule } from "../../core/rules/RuleSchema";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

function findMethodByName(scene: Scene, methodName: string): any {
    return scene.getMethods().find(method => method.getName?.() === methodName);
}

function findSinkStmtByMethod(scene: Scene, methodName: string): any {
    const method = findMethodByName(scene, methodName);
    const cfg = method?.getCfg?.();
    for (const stmt of cfg?.getStmts?.() || []) {
        if (!stmt?.containsInvokeExpr?.()) continue;
        const invokeExpr = stmt.getInvokeExpr?.();
        const signature = invokeExpr?.getMethodSignature?.()?.toString?.() || "";
        if (signature.includes("Sink")) {
            return stmt;
        }
    }
    return undefined;
}

function findSinkArgNodeId(scene: Scene, pag: Pag, methodName: string): number | undefined {
    const sinkStmt = findSinkStmtByMethod(scene, methodName);
    const invokeExpr = sinkStmt?.getInvokeExpr?.();
    const args = invokeExpr?.getArgs?.() || [];
    const arg0 = args[0];
    const nodes = arg0 ? pag.getNodesByValue(arg0) : undefined;
    return nodes ? [...nodes.values()][0] : undefined;
}

function findLocalNodeId(scene: Scene, pag: Pag, methodName: string, localName: string): number | undefined {
    const method = findMethodByName(scene, methodName);
    const cfg = method?.getCfg?.();
    for (const stmt of cfg?.getStmts?.() || []) {
        const candidates = [stmt.getLeftOp?.(), stmt.getRightOp?.()];
        for (const candidate of candidates) {
            if (candidate?.getName?.() !== localName) continue;
            const nodes = pag.getNodesByValue(candidate);
            if (nodes && nodes.size > 0) {
                return [...nodes.values()][0];
            }
        }
    }
    return undefined;
}

function findLocalObjectNodeId(scene: Scene, pag: Pag, methodName: string, localName: string): number | undefined {
    const method = findMethodByName(scene, methodName);
    const body = method?.getBody?.();
    const rawLocals = body?.getLocals?.();
    const locals = Array.isArray(rawLocals)
        ? rawLocals
        : rawLocals
            ? Array.from(rawLocals.values?.() || rawLocals)
            : [];
    const local = locals.find((candidate: any) => candidate?.getName?.() === localName);
    const tryResolvePointsToFromValue = (value: any): number | undefined => {
        const nodes = value ? pag.getNodesByValue(value) : undefined;
        if (!nodes) return undefined;
        for (const nodeId of nodes.values()) {
            const node = pag.getNode(nodeId) as any;
            const pointsTo = node?.getPointTo?.();
            if (pointsTo) {
                const ids = Array.from(pointsTo as Iterable<number>);
                if (ids.length > 0) {
                    return ids[0];
                }
            }
        }
        return undefined;
    };
    const direct = tryResolvePointsToFromValue(local);
    if (direct !== undefined) {
        return direct;
    }
    const cfg = method?.getCfg?.();
    for (const stmt of cfg?.getStmts?.() || []) {
        if (!stmt?.getLeftOp?.() || !stmt?.getRightOp?.()) continue;
        const leftOp = stmt.getLeftOp();
        if (leftOp?.getName?.() !== localName) continue;
        const indirect = tryResolvePointsToFromValue(stmt.getRightOp());
        if (indirect !== undefined) {
            return indirect;
        }
    }
    return undefined;
}

function findMethodSignature(scene: Scene, methodName: string): string {
    const method = findMethodByName(scene, methodName);
    assert(method, `method not found: ${methodName}`);
    return method.getSignature().toString();
}

function sourceRule(scene: Scene): SourceRule {
    const exact = projectApiEffectAssetFromMethod({
        id: "engine-plugin.source",
        role: "source",
        method: requiredMethod(scene, "Source"),
        endpoint: { base: { kind: "return" } },
        sourceKind: "call_return",
    });
    return {
        id: "source.fixture.rule",
        sourceKind: "call_return" as const,
        match: {
            kind: "canonical_api_id_equals" as const,
            value: exact.canonicalApiDescriptor.canonicalApiId,
        },
        apiEffect: exact.apiEffect,
        target: "result" as const,
    };
}

function sinkRule(scene: Scene): SinkRule {
    const exact = projectApiEffectAssetFromMethod({
        id: "engine-plugin.sink",
        role: "sink",
        method: requiredMethod(scene, "Sink"),
        endpoint: { base: { kind: "arg", index: 0 } },
        sinkKind: "test",
    });
    return {
        id: "sink.fixture.rule",
        match: {
            kind: "canonical_api_id_equals" as const,
            value: exact.canonicalApiDescriptor.canonicalApiId,
        },
        apiEffect: exact.apiEffect,
        target: "arg0" as const,
    };
}

function exactEngineOptions(scene: Scene, options: TaintEngineOptions = {}): TaintEngineOptions {
    const source = projectApiEffectAssetFromMethod({
        id: "engine-plugin.source",
        role: "source",
        method: requiredMethod(scene, "Source"),
        endpoint: { base: { kind: "return" } },
        sourceKind: "call_return",
    });
    const sink = projectApiEffectAssetFromMethod({
        id: "engine-plugin.sink",
        role: "sink",
        method: requiredMethod(scene, "Sink"),
        endpoint: { base: { kind: "arg", index: 0 } },
        sinkKind: "test",
    });
    const assets = [source.asset, sink.asset, ...(options.apiAssets || [])];
    const registry = createCanonicalApiRegistry([
        source.canonicalApiDescriptor,
        sink.canonicalApiDescriptor,
    ]);
    const assetIdentityIndex = createAssetIdentityIndex({ canonicalApiRegistry: registry });
    for (const asset of assets) {
        assetIdentityIndex.addAsset(asset);
    }
    return {
        ...options,
        apiAssets: assets,
        canonicalApiRegistry: registry,
        assetIdentityIndex,
    };
}

function requiredMethod(scene: Scene, methodName: string): any {
    const method = findMethodByName(scene, methodName);
    assert(method, `method not found: ${methodName}`);
    return method;
}

async function main(): Promise<void> {
    const projectDir = path.resolve("tests/fixtures/engine_plugin_runtime/project");
    const pluginDir = path.resolve("tests/fixtures/engine_plugin_runtime/external_plugins");
    const baselineEntryMethodName = "onCreate";
    const pluginOnlyEntryName = "pluginOnlyEntry";
    const baselineEntryMethodSignatureIncludes = ".onCreate(";
    const pluginOnlyMethodSignatureIncludes = ".pluginOnlyEntry(";

    const loadedPluginResult = loadEnginePlugins({
        includeBuiltinPlugins: false,
        pluginDirs: [pluginDir],
    });
    assert(loadedPluginResult.plugins.length === 1, "expected one runtime fixture engine plugin");
    assert(loadedPluginResult.plugins[0].name === "fixture.entry_and_rules", "unexpected fixture plugin name");
    assert(
        !loadedPluginResult.plugins.some(plugin => plugin.name === "fixture.disabled_inline"),
        "inline-disabled engine plugins should not be loaded",
    );
    assert(
        !loadedPluginResult.plugins.some(plugin => plugin.name === "fixture.disabled_file"),
        "file-disabled engine plugins should not be loaded",
    );
    const overrideExternalPlugin = defineEnginePlugin({
        name: "fixture.entry_and_rules",
    });
    const overriddenPluginResult = loadEnginePlugins({
        includeBuiltinPlugins: false,
        pluginDirs: [pluginDir],
        plugins: [overrideExternalPlugin],
    });
    assert(overriddenPluginResult.plugins.length === 1, "explicit plugin object should replace external duplicate name");
    assert(
        overriddenPluginResult.plugins[0] === overrideExternalPlugin,
        "explicit plugin object should win over external plugin with the same name",
    );
    assert(
        overriddenPluginResult.warnings.some(w => w.includes("engine plugin fixture.entry_and_rules") && w.includes("overrides external plugin")),
        "overriding a loaded external plugin should emit an explicit override warning",
    );
    const disabledPluginResult = loadEnginePlugins({
        includeBuiltinPlugins: false,
        pluginDirs: [pluginDir],
        disabledPluginNames: ["fixture.entry_and_rules"],
    });
    assert(disabledPluginResult.plugins.length === 0, "disable-plugins should disable external plugins");
    assert(
        disabledPluginResult.warnings.length === 0,
        "disable-plugins should not warn when disabled plugins coexist with in-file disabled plugins",
    );
    const disabledInlinePluginResult = loadEnginePlugins({
        includeBuiltinPlugins: false,
        pluginDirs: [pluginDir],
        disabledPluginNames: ["fixture.disabled_inline", "fixture.disabled_file"],
    });
    assert(
        disabledInlinePluginResult.warnings.length === 0,
        "disable-plugins should not warn for plugins that are already disabled in-file",
    );

    {
        const scene = buildTestScene(projectDir);
        const engine = new TaintPropagationEngine(scene, 1, exactEngineOptions(scene));
        engine.verbose = false;
        await engine.buildPAG({ entryModel: "arkMain" });
        const reachable = engine.computeReachableMethodSignatures();
        assert(
            [...reachable].some(sig => sig.includes(baselineEntryMethodSignatureIncludes)),
            "default arkMain should discover the formal lifecycle baseline entry",
        );
        assert(
            ![...reachable].some(sig => sig.includes(pluginOnlyMethodSignatureIncludes)),
            "pluginOnlyEntry should not be reachable without engine plugin",
        );
    }

    {
        const scene = buildTestScene(projectDir);
        const engine = new TaintPropagationEngine(scene, 1, exactEngineOptions(scene, {
            enginePlugins: loadedPluginResult.plugins,
        }));
        engine.verbose = false;
        await engine.buildPAG({ entryModel: "arkMain" });
        const reachable = engine.computeReachableMethodSignatures();
        engine.setActiveReachableMethodSignatures(reachable);
        assert(
            [...reachable].some(sig => sig.includes(pluginOnlyMethodSignatureIncludes)),
            "engine plugin addEntry should make pluginOnlyEntry reachable",
        );
        const seeds = engine.propagateWithSourceRules([]);
        assert(seeds.seedCount > 0, "engine plugin start hook should inject source rules");
        const flows = engine.detectSinksByRules([]);
        assert(flows.length > 0, "engine plugin start hook should inject sink rules");
        assert(
            engine.getLoadedEnginePluginNames().includes("fixture.entry_and_rules"),
            "engine should expose loaded plugin names",
        );
    }

    {
        const scene = buildTestScene(projectDir);
        const engine = new TaintPropagationEngine(scene, 1, exactEngineOptions(scene, {
            enginePlugins: loadedPluginResult.plugins,
            pluginDryRun: true,
        }));
        engine.verbose = false;
        await engine.buildPAG({ entryModel: "arkMain" });
        const reachable = engine.computeReachableMethodSignatures();
        engine.setActiveReachableMethodSignatures(reachable);
        assert(
            ![...reachable].some(sig => sig.includes(pluginOnlyMethodSignatureIncludes)),
            "plugin dry-run should not mutate entry discovery",
        );
        const seeds = engine.propagateWithSourceRules([]);
        assert(seeds.seedCount === 0, "plugin dry-run should not inject source rules");
    }

    {
        const scene = buildTestScene(projectDir);
        const buildMethod = findMethodByName(scene, baselineEntryMethodName);
        const brokenStartPlugin = defineEnginePlugin({
            name: "fixture.broken_start",
            onStart() {
                throw new Error("broken-start");
            },
        });
        const engine = new TaintPropagationEngine(scene, 1, exactEngineOptions(scene, {
            enginePlugins: [brokenStartPlugin],
        }));
        engine.verbose = false;
        await engine.buildPAG({
            entryModel: "arkMain",
            syntheticEntryMethods: buildMethod ? [buildMethod] : undefined,
        });
        engine.setActiveReachableMethodSignatures(engine.computeReachableMethodSignatures());
        const seeds = engine.propagateWithSourceRules([sourceRule(scene)]);
        assert(seeds.seedCount > 0, "broken start plugin should be isolated and baseline seeding should continue");
        const findings = engine.detectSinksByRules([sinkRule(scene)]);
        assert(findings.length > 0, "broken start plugin should not abort baseline detection");
        const pluginAudit = engine.getEnginePluginAuditSnapshot();
        assert(pluginAudit.failedPluginNames.includes("fixture.broken_start"), "engine plugin audit should expose failed plugin names");
        assert(
            pluginAudit.failureEvents.some(event => event.pluginName === "fixture.broken_start" && event.phase === "onStart" && event.message.includes("broken-start")),
            "engine plugin audit should record onStart failure details",
        );
        assert(
            pluginAudit.failureEvents.some(event => event.pluginName === "fixture.broken_start" && typeof event.line === "number" && typeof event.column === "number"),
            "engine plugin audit should record failure line/column when stack information is available",
        );
    }

    {
        const scene = buildTestScene(projectDir);
        const buildMethod = findMethodByName(scene, baselineEntryMethodName);
        const events = {
            callEdges: 0,
            taintFlows: 0,
            methods: 0,
        };
        const observerPlugin = defineEnginePlugin({
            name: "fixture.observer",
            onPropagation(api) {
                api.onCallEdge(() => {
                    events.callEdges++;
                });
                api.onTaintFlow(() => {
                    events.taintFlows++;
                });
                api.onMethodReached(() => {
                    events.methods++;
                });
            },
        });
        const engine = new TaintPropagationEngine(scene, 1, exactEngineOptions(scene, {
            enginePlugins: [observerPlugin],
        }));
        engine.verbose = false;
        await engine.buildPAG({
            entryModel: "arkMain",
            syntheticEntryMethods: buildMethod ? [buildMethod] : undefined,
        });
        engine.setActiveReachableMethodSignatures(engine.computeReachableMethodSignatures());
        engine.propagateWithSourceRules([sourceRule(scene)]);
        const pluginAudit = engine.getEnginePluginAuditSnapshot();
        assert(
            pluginAudit.lastPropagationPhase?.taintFlowObserverCount === 1,
            "onTaintFlow observer should be registered without an implicit propagation runner",
        );
        assert(events.methods > 0, "onMethodReached should observe reached methods");
    }

    {
        const scene = buildTestScene(projectDir);
        const buildMethod = findMethodByName(scene, baselineEntryMethodName);
        let failureCount = 0;
        const brokenObserverPlugin = defineEnginePlugin({
            name: "fixture.broken_observer",
            onPropagation(api) {
                api.onMethodReached(() => {
                    failureCount++;
                    throw new Error("broken-observer");
                });
            },
        });
        const engine = new TaintPropagationEngine(scene, 1, exactEngineOptions(scene, {
            enginePlugins: [brokenObserverPlugin],
        }));
        engine.verbose = false;
        await engine.buildPAG({
            entryModel: "arkMain",
            syntheticEntryMethods: buildMethod ? [buildMethod] : undefined,
        });
        engine.setActiveReachableMethodSignatures(engine.computeReachableMethodSignatures());
        const seeds = engine.propagateWithSourceRules([sourceRule(scene)]);
        assert(seeds.seedCount > 0, "broken propagation observer should not stop baseline propagation");
        const findings = engine.detectSinksByRules([sinkRule(scene)]);
        assert(findings.length > 0, "broken propagation observer should not stop baseline findings");
        assert(failureCount === 1, "broken propagation observer should be disabled after its first failure");
        const pluginAudit = engine.getEnginePluginAuditSnapshot();
        assert(
            pluginAudit.failureEvents.some(event => event.pluginName === "fixture.broken_observer" && event.phase === "propagation.observer" && event.message.includes("broken-observer")),
            "engine plugin audit should record propagation observer failure details",
        );
        assert(
            pluginAudit.failureEvents.some(event => event.pluginName === "fixture.broken_observer" && event.userMessage.includes("failed in propagation.observer") && event.userMessage.includes(":")),
            "engine plugin user message should stay concise and include location when available",
        );
    }

    {
        const scene = buildTestScene(projectDir);
        const buildMethod = findMethodByName(scene, baselineEntryMethodName);
        const extraSinkStmt = findSinkStmtByMethod(scene, "extraCheckEntry");
        assert(extraSinkStmt, "expected extraCheckEntry sink stmt");
        const addCheckPlugin = defineEnginePlugin({
            name: "fixture.extra_check",
            onDetection(api) {
                api.addCheck("extra-check", () => {
                    return [new TaintFlow("plugin:extra-check", extraSinkStmt)];
                });
            },
        });
        const engine = new TaintPropagationEngine(scene, 1, exactEngineOptions(scene, {
            enginePlugins: [addCheckPlugin],
        }));
        engine.verbose = false;
        await engine.buildPAG({
            entryModel: "arkMain",
            syntheticEntryMethods: buildMethod ? [buildMethod] : undefined,
        });
        const findings = engine.detectSinksByRules([]);
        assert(findings.length === 1, "onDetection.addCheck should append custom findings");
        assert(findings[0].source === "plugin:extra-check", "unexpected custom finding source");
    }

    {
        const scene = buildTestScene(projectDir);
        const buildMethod = findMethodByName(scene, baselineEntryMethodName);
        const filterPlugin = defineEnginePlugin({
            name: "fixture.filter_all",
            onResult(api) {
                api.filter(() => null);
            },
        });
        const engine = new TaintPropagationEngine(scene, 1, exactEngineOptions(scene, {
            enginePlugins: [filterPlugin],
        }));
        engine.verbose = false;
        await engine.buildPAG({
            entryModel: "arkMain",
            syntheticEntryMethods: buildMethod ? [buildMethod] : undefined,
        });
        engine.setActiveReachableMethodSignatures(engine.computeReachableMethodSignatures());
        const seeds = engine.propagateWithSourceRules([sourceRule(scene)]);
        assert(seeds.seedCount > 0, "expected fixture source rule to seed");
        const findings = engine.detectSinksByRules([sinkRule(scene)]);
        assert(findings.length === 0, "onResult.filter should remove default findings");
    }

    {
        const scene = buildTestScene(projectDir);
        const manualFlowMethod = findMethodByName(scene, "manualFlowEntry");
        assert(manualFlowMethod, "expected manualFlowEntry method");
        let flowInjected = false;
        const flowPlugin = defineEnginePlugin({
            name: "fixture.add_flow",
            onPropagation(api) {
                api.onMethodReached(() => {
                    if (flowInjected) return;
                    const targetNodeId = findLocalNodeId(api.getScene(), api.getPag(), "manualFlowEntry", "this");
                    if (targetNodeId === undefined) return;
                    flowInjected = true;
                    api.addFlow({
                        nodeId: targetNodeId,
                        reason: "Plugin-Flow",
                        allowUnreachableTarget: true,
                    });
                });
            },
        });
        const withoutPlugin = new TaintPropagationEngine(scene, 1, exactEngineOptions(scene));
        withoutPlugin.verbose = false;
        await withoutPlugin.buildPAG({
            entryModel: "arkMain",
            syntheticEntryMethods: [manualFlowMethod],
        });
        withoutPlugin.setActiveReachableMethodSignatures(withoutPlugin.computeReachableMethodSignatures());
        withoutPlugin.propagateWithSourceRules([sourceRule(scene)]);
        const baselineTargetNodeId = findLocalNodeId(scene, (withoutPlugin as any).pag as Pag, "manualFlowEntry", "this");
        assert(baselineTargetNodeId !== undefined, "expected manualFlowEntry this node");
        const baselineFacts = withoutPlugin.getObservedTaintFacts().get(baselineTargetNodeId) || [];
        assert(baselineFacts.length === 0, "manualFlowEntry this node should be clean without plugin addFlow");

        const pluginScene = buildTestScene(projectDir);
        const withPluginMethod = findMethodByName(pluginScene, "manualFlowEntry");
        const withPlugin = new TaintPropagationEngine(pluginScene, 1, exactEngineOptions(pluginScene, {
            enginePlugins: [flowPlugin],
        }));
        withPlugin.verbose = false;
        await withPlugin.buildPAG({
            entryModel: "arkMain",
            syntheticEntryMethods: withPluginMethod ? [withPluginMethod] : undefined,
        });
        withPlugin.setActiveReachableMethodSignatures(withPlugin.computeReachableMethodSignatures());
        withPlugin.propagateWithSourceRules([sourceRule(pluginScene)]);
        const targetNodeId = findLocalNodeId(pluginScene, (withPlugin as any).pag as Pag, "manualFlowEntry", "this");
        assert(targetNodeId !== undefined, "expected manualFlowEntry this node");
        const facts = withPlugin.getObservedTaintFacts().get(targetNodeId) || [];
        assert(facts.length > 0, "PropagationApi.addFlow should taint the manualFlowEntry this node");
    }

    {
        const scene = buildTestScene(projectDir);
        const manualSyntheticMethod = findMethodByName(scene, "manualSyntheticEntry");
        assert(manualSyntheticMethod, "expected manualSyntheticEntry method");
        let syntheticInjected = false;
        const syntheticPlugin = defineEnginePlugin({
            name: "fixture.add_synthetic_edge",
            onPropagation(api) {
                api.onMethodReached(() => {
                    if (syntheticInjected) return;
                    const targetNodeId = findLocalNodeId(api.getScene(), api.getPag(), "manualSyntheticEntry", "this");
                    if (targetNodeId === undefined) return;
                    syntheticInjected = true;
                    api.addSyntheticEdge({
                        edgeType: "return",
                        targetNodeId,
                        callSiteId: 900001,
                        callerMethodName: "fixture.synthetic.caller",
                        calleeMethodName: "fixture.synthetic.callee",
                        reason: "Plugin-Synthetic-Return",
                        allowUnreachableTarget: true,
                    });
                });
            },
        });
        const baseline = new TaintPropagationEngine(scene, 1, exactEngineOptions(scene));
        baseline.verbose = false;
        await baseline.buildPAG({
            entryModel: "arkMain",
            syntheticEntryMethods: [manualSyntheticMethod],
        });
        baseline.setActiveReachableMethodSignatures(baseline.computeReachableMethodSignatures());
        baseline.propagateWithSourceRules([sourceRule(scene)]);
        const baselineTargetNodeId = findLocalNodeId(scene, (baseline as any).pag as Pag, "manualSyntheticEntry", "this");
        assert(baselineTargetNodeId !== undefined, "expected manualSyntheticEntry this node");
        const baselineFacts = baseline.getObservedTaintFacts().get(baselineTargetNodeId) || [];
        assert(baselineFacts.length === 0, "manualSyntheticEntry this node should be clean without plugin synthetic edge");
        const engine = new TaintPropagationEngine(scene, 1, exactEngineOptions(scene, {
            enginePlugins: [syntheticPlugin],
        }));
        engine.verbose = false;
        await engine.buildPAG({
            entryModel: "arkMain",
            syntheticEntryMethods: [manualSyntheticMethod],
        });
        engine.setActiveReachableMethodSignatures(engine.computeReachableMethodSignatures());
        engine.propagateWithSourceRules([sourceRule(scene)]);
        const targetNodeId = findLocalNodeId(scene, (engine as any).pag as Pag, "manualSyntheticEntry", "this");
        assert(targetNodeId !== undefined, "expected manualSyntheticEntry this node");
        const facts = engine.getObservedTaintFacts().get(targetNodeId) || [];
        assert(facts.length > 0, "PropagationApi.addSyntheticEdge should taint the manualSyntheticEntry this node");
    }

    {
        const scene = buildTestScene(projectDir);
        const manualBridgeMethod = findMethodByName(scene, "manualBridgeEntry");
        assert(manualBridgeMethod, "expected manualBridgeEntry method");
        let bridgeInjected = false;
        const bridgePlugin = defineEnginePlugin({
            name: "fixture.add_bridge",
            onPropagation(api) {
                api.onMethodReached(() => {
                    if (bridgeInjected) return;
                    const boxNodeId = findLocalObjectNodeId(api.getScene(), api.getPag(), "manualBridgeEntry", "box");
                    if (boxNodeId === undefined) return;
                    bridgeInjected = true;
                    api.addBridge({
                        targetObjectNodeId: boxNodeId,
                        targetFieldName: "b",
                        reason: "Plugin-Bridge",
                    });
                });
            },
        });
        const engine = new TaintPropagationEngine(scene, 1, exactEngineOptions(scene, {
            enginePlugins: [bridgePlugin],
        }));
        engine.verbose = false;
        await engine.buildPAG({
            entryModel: "arkMain",
            syntheticEntryMethods: [manualBridgeMethod],
        });
        engine.setActiveReachableMethodSignatures(engine.computeReachableMethodSignatures());
        engine.propagateWithSourceRules([sourceRule(scene)]);
        const sinkNodeId = findSinkArgNodeId(scene, (engine as any).pag as Pag, "manualBridgeEntry");
        assert(sinkNodeId !== undefined, "expected manualBridgeEntry sink arg node");
        const facts = engine.getObservedTaintFacts().get(sinkNodeId) || [];
        assert(facts.length > 0, "PropagationApi.addBridge should taint the manualBridgeEntry sink arg node");
    }

    {
        const scene = buildTestScene(projectDir);
        const buildMethod = findMethodByName(scene, baselineEntryMethodName);
        const replaceA = defineEnginePlugin({
            name: "fixture.replace.a",
            onPropagation(api) {
                api.replace(input => ({ visitedCount: input.visited.size }));
            },
        });
        const replaceB = defineEnginePlugin({
            name: "fixture.replace.b",
            onPropagation(api) {
                api.replace(input => ({ visitedCount: input.visited.size }));
            },
        });
        const engine = new TaintPropagationEngine(scene, 1, exactEngineOptions(scene, {
            enginePlugins: [replaceA, replaceB],
        }));
        engine.verbose = false;
        await engine.buildPAG({
            entryModel: "arkMain",
            syntheticEntryMethods: buildMethod ? [buildMethod] : undefined,
        });
        engine.setActiveReachableMethodSignatures(engine.computeReachableMethodSignatures());
        let conflictCaught = false;
        try {
            engine.propagateWithSourceRules([sourceRule(scene)]);
        } catch (error) {
            conflictCaught = String(error).includes("engine plugin propagation replace conflict");
        }
        assert(conflictCaught, "multiple propagation replace hooks should conflict");
    }

    console.log("PASS test_engine_plugin_runtime");
    console.log(`loaded_plugin_file=${path.basename(loadedPluginResult.loadedFiles[0])}`);
    console.log(`loaded_plugin_count=${loadedPluginResult.plugins.length}`);
}

main().catch((error) => {
    console.error("FAIL test_engine_plugin_runtime");
    console.error(error);
    process.exit(1);
});
