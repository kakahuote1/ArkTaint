import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../../arkanalyzer/out/src/Config";
import { TaintPropagationEngine } from "../../core/orchestration/TaintPropagationEngine";
import { PagNode } from "../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import { SinkRule, TransferRule } from "../../core/rules/RuleSchema";
import * as path from "path";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

function flowSinkInMethod(scene: Scene, sinkStmt: any, methodName: string): boolean {
    const method = scene.getMethods().find(m => m.getName() === methodName);
    const cfg = method?.getCfg();
    return !!cfg && cfg.getStmts().includes(sinkStmt);
}

function findSeedNodes(engine: TaintPropagationEngine, scene: Scene, methodName: string, localName: string): PagNode[] {
    const method = scene.getMethods().find(m => m.getName() === methodName);
    assert(method, `method not found: ${methodName}`);
    const cfg = method.getCfg();
    assert(cfg, `cfg not found: ${methodName}`);
    for (const stmt of cfg.getStmts()) {
        const left = (stmt as any).getLeftOp?.();
        if (!left || left.getName?.() !== localName) continue;
        const nodeIds = engine.pag.getNodesByValue(left);
        return nodeIds ? [...nodeIds.values()].map(id => engine.pag.getNode(id) as PagNode) : [];
    }
    return [];
}

async function main(): Promise<void> {
    const sourceDir = path.resolve("tests/demo/rule_precision_sink");
    const sceneConfig = new SceneConfig();
    sceneConfig.buildFromProjectDir(sourceDir);
    const scene = new Scene();
    scene.buildSceneFromProjectDir(sceneConfig);
    scene.inferTypes();
    const entryMethod = scene.getMethods().find(m => m.getName() === "sink_inline_transfer_payload_017_T");
    assert(entryMethod, "expected sink_inline_transfer_payload_017_T entry method");

    const transferRules: TransferRule[] = [
        {
            id: "transfer.precision.inline_payload_box.to_bucket",
            match: {
                kind: "method_name_equals",
                value: "toBucket",
                invokeKind: "instance",
                argCount: 0,
            },
            scope: {
                className: { mode: "equals", value: "InlinePayloadBox" },
            },
            from: "base",
            to: "result",
        },
    ];
    const sinkRules: SinkRule[] = [
        {
            id: "sink.precision.inline_db.update.arg0",
            family: "sink.precision.inline_db.update",
            tier: "C",
            match: {
                kind: "method_name_equals",
                value: "update",
                invokeKind: "instance",
                argCount: 3,
            },
            scope: {
                className: { mode: "equals", value: "InlineDb" },
            },
            target: { endpoint: "arg0" },
        },
    ];
    const sameFamilyNoFlowSinkRules: SinkRule[] = [
        {
            id: "sink.precision.inline_db.update.arg1.no_flow",
            family: "sink.precision.inline_db.update",
            tier: "A",
            match: {
                kind: "method_name_equals",
                value: "update",
                invokeKind: "instance",
                argCount: 3,
            },
            scope: {
                className: { mode: "equals", value: "InlineDb" },
            },
            target: { endpoint: "arg1" },
        },
        ...sinkRules,
    ];

    const detect = async (rules: TransferRule[], sinks: SinkRule[] = sinkRules) => {
        const engine = new TaintPropagationEngine(scene, 1, { transferRules: rules });
        engine.verbose = false;
        await engine.buildPAG({
            entryModel: "explicit",
            syntheticEntryMethods: [entryMethod],
        });
        const seedNodes = findSeedNodes(engine, scene, "sink_inline_transfer_payload_017_T", "taint_src");
        assert(seedNodes.length > 0, "expected taint_src PAG seed nodes");
        engine.propagateWithSeeds(seedNodes);
        const flows = engine.detectSinksByRules(sinks)
            .filter(flow => flowSinkInMethod(scene, flow.sink, "sink_inline_transfer_payload_017_T"));
        return { seedCount: seedNodes.length, flows };
    };

    const withoutTransfer = await detect([]);
    const withTransfer = await detect(transferRules);
    const withSameFamilyNoFlowHigherTier = await detect(transferRules, sameFamilyNoFlowSinkRules);

    console.log("====== Sink Inline Transfer Payload Test ======");
    console.log(`seed_count=${withTransfer.seedCount}`);
    console.log(`without_transfer_flow_count=${withoutTransfer.flows.length}`);
    console.log(`with_transfer_flow_count=${withTransfer.flows.length}`);
    console.log(`with_same_family_no_flow_higher_tier_count=${withSameFamilyNoFlowHigherTier.flows.length}`);
    console.log(`flow_sources=${withTransfer.flows.map(flow => flow.source).join(",")}`);
    console.log(`flow_transfer_rules=${withTransfer.flows.map(flow => (flow.transferRuleIds || []).join("+") || "<none>").join(",")}`);

    assert(withoutTransfer.flows.length === 0, "inline payload sink must not be detected without a matching transfer model");
    assert(withTransfer.flows.length >= 1, "expected inline transfer result passed to sink arg0 to be detected");
    assert(withSameFamilyNoFlowHigherTier.flows.length >= 1,
        "a higher-tier same-family rule with no flow must not suppress a lower-tier rule that detects a different endpoint");
    assert(withSameFamilyNoFlowHigherTier.flows.some(flow => flow.sinkEndpoint === "arg0"),
        "same-family priority must stay endpoint-scoped so the payload endpoint remains reportable");
    assert(withTransfer.flows.some(flow => flow.sinkEndpoint === "arg0"), "expected sink endpoint arg0");
    assert(withTransfer.flows.some(flow => (flow.transferRuleIds || []).includes("transfer.precision.inline_payload_box.to_bucket")),
        "expected detected flow to carry the inline transfer rule id");
}

main().catch(err => {
    console.error(err);
    process.exitCode = 1;
});
