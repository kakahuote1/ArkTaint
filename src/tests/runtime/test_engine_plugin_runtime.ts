import * as path from "path";
import { Scene } from "../../../arkanalyzer/lib/Scene";
import { Pag } from "../../../arkanalyzer/lib/callgraph/pointerAnalysis/Pag";
import { TaintPropagationEngine } from "../../core/orchestration/TaintPropagationEngine";
import { TaintFlow } from "../../core/kernel/model/TaintFlow";
import { loadEnginePlugins } from "../../core/orchestration/plugins/EnginePluginLoader";
import { defineEnginePlugin } from "../../core/orchestration/plugins/EnginePlugin";
import { buildTestScene } from "../helpers/TestSceneBuilder";

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

function sourceRule() {
    return {
        id: "source.fixture.rule",
        sourceKind: "call_return" as const,
        match: {
            kind: "method_name_equals" as const,
            value: "Source",
        },
        target: "result" as const,
    };
}

function sinkRule() {
    return {
        id: "sink.fixture.rule",
        match: {
            kind: "method_name_equals" as const,
            value: "Sink",
        },
        target: "arg0" as const,
    };
}

async function main(): Promise<void> {
    const projectDir = path.resolve("tests/fixtures/engine_plugin_runtime/project");
    const pluginDir = path.resolve("tests/fixtures/engine_plugin_runtime/external_plugins");
    const buildMethodName = "build";
    const pluginOnlyEntryName = "pluginOnlyEntry";
    const buildMethodSignatureIncludes = ".build(";
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
        const engine = new TaintPropagationEngine(scene, 1);
        engine.verbose = false;
        await engine.buildPAG({ entryModel: "arkMain" });
        const reachable = engine.computeReachableMethodSignatures();
        assert(
            [...reachable].some(sig => sig.includes(buildMethodSignatureIncludes)),
            "default arkMain should still discover build()",
        );
        assert(
            ![...reachable].some(sig => sig.includes(pluginOnlyMethodSignatureIncludes)),
            "pluginOnlyEntry should not be reachable without engine plugin",
        );
    }

    {
        const scene = buildTestScene(projectDir);
        const engine = new TaintPropagationEngine(scene, 1, {
            enginePlugins: loadedPluginResult.plugins,
        });
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
        const engine = new TaintPropagationEngine(scene, 1, {
            enginePlugins: loadedPluginResult.plugins,
            pluginDryRun: true,
        });
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
        const buildMethod = findMethodByName(scene, buildMethodName);
        const brokenStartPlugin = defineEnginePlugin({
            name: "fixture.broken_start",
            onStart() {
                throw new Error("broken-start");
            },
        });
        const engine = new TaintPropagationEngine(scene, 1, {
            enginePlugins: [brokenStartPlugin],
        });
        engine.verbose = false;
        await engine.buildPAG({
            entryModel: "arkMain",
            syntheticEntryMethods: buildMethod ? [buildMethod] : undefined,
        });
        engine.setActiveReachableMethodSignatures(engine.computeReachableMethodSignatures());
        const seeds = engine.propagateWithSourceRules([sourceRule()]);
        assert(seeds.seedCount > 0, "broken start plugin should be isolated and baseline seeding should continue");
        const findings = engine.detectSinksByRules([sinkRule()]);
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
        const buildMethod = findMethodByName(scene, buildMethodName);
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
        const engine = new TaintPropagationEngine(scene, 1, {
            enginePlugins: [observerPlugin],
        });
        engine.verbose = false;
        await engine.buildPAG({
            entryModel: "arkMain",
            syntheticEntryMethods: buildMethod ? [buildMethod] : undefined,
        });
        engine.setActiveReachableMethodSignatures(engine.computeReachableMethodSignatures());
        engine.propagateWithSourceRules([sourceRule()]);
        assert(events.taintFlows > 0, "onTaintFlow should observe propagation edges");
        assert(events.methods > 0, "onMethodReached should observe reached methods");
    }

    {
        const scene = buildTestScene(projectDir);
        const buildMethod = findMethodByName(scene, buildMethodName);
        let failureCount = 0;
        const brokenObserverPlugin = defineEnginePlugin({
            name: "fixture.broken_observer",
            onPropagation(api) {
                api.onTaintFlow(() => {
                    failureCount++;
                    throw new Error("broken-observer");
                });
            },
        });
        const engine = new TaintPropagationEngine(scene, 1, {
            enginePlugins: [brokenObserverPlugin],
        });
        engine.verbose = false;
        await engine.buildPAG({
            entryModel: "arkMain",
            syntheticEntryMethods: buildMethod ? [buildMethod] : undefined,
        });
        engine.setActiveReachableMethodSignatures(engine.computeReachableMethodSignatures());
        const seeds = engine.propagateWithSourceRules([sourceRule()]);
        assert(seeds.seedCount > 0, "broken propagation observer should not stop baseline propagation");
        const findings = engine.detectSinksByRules([sinkRule()]);
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
        const buildMethod = findMethodByName(scene, buildMethodName);
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
        const engine = new TaintPropagationEngine(scene, 1, {
            enginePlugins: [addCheckPlugin],
        });
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
        const buildMethod = findMethodByName(scene, buildMethodName);
        const filterPlugin = defineEnginePlugin({
            name: "fixture.filter_all",
            onResult(api) {
                api.filter(() => null);
            },
        });
        const engine = new TaintPropagationEngine(scene, 1, {
            enginePlugins: [filterPlugin],
        });
        engine.verbose = false;
        await engine.buildPAG({
            entryModel: "arkMain",
            syntheticEntryMethods: buildMethod ? [buildMethod] : undefined,
        });
        engine.setActiveReachableMethodSignatures(engine.computeReachableMethodSignatures());
        const seeds = engine.propagateWithSourceRules([sourceRule()]);
        assert(seeds.seedCount > 0, "expected fixture source rule to seed");
        const findings = engine.detectSinksByRules([sinkRule()]);
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
                api.onTaintFlow(() => {
                    if (flowInjected) return;
                    const sinkArgNodeId = findSinkArgNodeId(api.getScene(), api.getPag(), "manualFlowEntry");
                    if (sinkArgNodeId === undefined) return;
                    flowInjected = true;
                    api.addFlow({
                        nodeId: sinkArgNodeId,
                        reason: "Plugin-Flow",
                    });
                });
            },
        });
        const withoutPlugin = new TaintPropagationEngine(scene, 1);
        withoutPlugin.verbose = false;
        await withoutPlugin.buildPAG({
            entryModel: "arkMain",
            syntheticEntryMethods: [manualFlowMethod],
        });
        withoutPlugin.setActiveReachableMethodSignatures(withoutPlugin.computeReachableMethodSignatures());
        withoutPlugin.propagateWithSourceRules([sourceRule()]);
        const baselineSinkNodeId = findSinkArgNodeId(scene, (withoutPlugin as any).pag as Pag, "manualFlowEntry");
        assert(baselineSinkNodeId !== undefined, "expected manualFlowEntry sink arg node");
        const baselineFacts = withoutPlugin.getObservedTaintFacts().get(baselineSinkNodeId) || [];
        assert(baselineFacts.length === 0, "manualFlowEntry sink arg should be clean without plugin addFlow");

        const pluginScene = buildTestScene(projectDir);
        const withPluginMethod = findMethodByName(pluginScene, "manualFlowEntry");
        const withPlugin = new TaintPropagationEngine(pluginScene, 1, {
            enginePlugins: [flowPlugin],
        });
        withPlugin.verbose = false;
        await withPlugin.buildPAG({
            entryModel: "arkMain",
            syntheticEntryMethods: withPluginMethod ? [withPluginMethod] : undefined,
        });
        withPlugin.setActiveReachableMethodSignatures(withPlugin.computeReachableMethodSignatures());
        withPlugin.propagateWithSourceRules([sourceRule()]);
        const sinkNodeId = findSinkArgNodeId(pluginScene, (withPlugin as any).pag as Pag, "manualFlowEntry");
        assert(sinkNodeId !== undefined, "expected manualFlowEntry sink arg node");
        const facts = withPlugin.getObservedTaintFacts().get(sinkNodeId) || [];
        assert(facts.length > 0, "PropagationApi.addFlow should taint the manualFlowEntry sink arg node");
    }

    {
        const scene = buildTestScene(projectDir);
        const manualSyntheticMethod = findMethodByName(scene, "manualSyntheticEntry");
        assert(manualSyntheticMethod, "expected manualSyntheticEntry method");
        let syntheticInjected = false;
        const syntheticPlugin = defineEnginePlugin({
            name: "fixture.add_synthetic_edge",
            onPropagation(api) {
                api.onTaintFlow(() => {
                    if (syntheticInjected) return;
                    const sinkArgNodeId = findSinkArgNodeId(api.getScene(), api.getPag(), "manualSyntheticEntry");
                    if (sinkArgNodeId === undefined) return;
                    syntheticInjected = true;
                    api.addSyntheticEdge({
                        edgeType: "return",
                        targetNodeId: sinkArgNodeId,
                        callSiteId: 900001,
                        callerMethodName: "fixture.synthetic.caller",
                        calleeMethodName: "fixture.synthetic.callee",
                        reason: "Plugin-Synthetic-Return",
                    });
                });
            },
        });
        const baseline = new TaintPropagationEngine(scene, 1);
        baseline.verbose = false;
        await baseline.buildPAG({
            entryModel: "arkMain",
            syntheticEntryMethods: [manualSyntheticMethod],
        });
        baseline.setActiveReachableMethodSignatures(baseline.computeReachableMethodSignatures());
        baseline.propagateWithSourceRules([sourceRule()]);
        const baselineSinkNodeId = findSinkArgNodeId(scene, (baseline as any).pag as Pag, "manualSyntheticEntry");
        assert(baselineSinkNodeId !== undefined, "expected manualSyntheticEntry sink arg node");
        const baselineFacts = baseline.getObservedTaintFacts().get(baselineSinkNodeId) || [];
        assert(baselineFacts.length === 0, "manualSyntheticEntry sink arg should be clean without plugin synthetic edge");
        const engine = new TaintPropagationEngine(scene, 1, {
            enginePlugins: [syntheticPlugin],
        });
        engine.verbose = false;
        await engine.buildPAG({
            entryModel: "arkMain",
            syntheticEntryMethods: [manualSyntheticMethod],
        });
        engine.setActiveReachableMethodSignatures(engine.computeReachableMethodSignatures());
        engine.propagateWithSourceRules([sourceRule()]);
        const sinkNodeId = findSinkArgNodeId(scene, (engine as any).pag as Pag, "manualSyntheticEntry");
        assert(sinkNodeId !== undefined, "expected manualSyntheticEntry sink arg node");
        const facts = engine.getObservedTaintFacts().get(sinkNodeId) || [];
        assert(facts.length > 0, "PropagationApi.addSyntheticEdge should taint the manualSyntheticEntry sink arg node");
    }

    {
        const scene = buildTestScene(projectDir);
        const manualBridgeMethod = findMethodByName(scene, "manualBridgeEntry");
        assert(manualBridgeMethod, "expected manualBridgeEntry method");
        let bridgeInjected = false;
        const bridgePlugin = defineEnginePlugin({
            name: "fixture.add_bridge",
            onPropagation(api) {
                api.onTaintFlow(() => {
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
        const engine = new TaintPropagationEngine(scene, 1, {
            enginePlugins: [bridgePlugin],
        });
        engine.verbose = false;
        await engine.buildPAG({
            entryModel: "arkMain",
            syntheticEntryMethods: [manualBridgeMethod],
        });
        engine.setActiveReachableMethodSignatures(engine.computeReachableMethodSignatures());
        engine.propagateWithSourceRules([sourceRule()]);
        const sinkNodeId = findSinkArgNodeId(scene, (engine as any).pag as Pag, "manualBridgeEntry");
        assert(sinkNodeId !== undefined, "expected manualBridgeEntry sink arg node");
        const facts = engine.getObservedTaintFacts().get(sinkNodeId) || [];
        assert(facts.length > 0, "PropagationApi.addBridge should taint the manualBridgeEntry sink arg node");
    }

    {
        const scene = buildTestScene(projectDir);
        const buildMethod = findMethodByName(scene, buildMethodName);
        const replaceA = defineEnginePlugin({
            name: "fixture.replace.a",
            onPropagation(api) {
                api.replace((input, fallback) => fallback.run(input));
            },
        });
        const replaceB = defineEnginePlugin({
            name: "fixture.replace.b",
            onPropagation(api) {
                api.replace((input, fallback) => fallback.run(input));
            },
        });
        const engine = new TaintPropagationEngine(scene, 1, {
            enginePlugins: [replaceA, replaceB],
        });
        engine.verbose = false;
        await engine.buildPAG({
            entryModel: "arkMain",
            syntheticEntryMethods: buildMethod ? [buildMethod] : undefined,
        });
        engine.setActiveReachableMethodSignatures(engine.computeReachableMethodSignatures());
        let conflictCaught = false;
        try {
            engine.propagateWithSourceRules([sourceRule()]);
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
