import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../../arkanalyzer/out/src/Config";
import { TaintPropagationEngine } from "../../core/orchestration/TaintPropagationEngine";
import { PagNode } from "../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import { SinkRule, TransferRule } from "../../core/rules/RuleSchema";
import * as path from "path";
import { exactRuleRuntimeFromFixtures, exactSinkRule, exactTransferRule, type ExactRuleFixture } from "./ExactRuleTestUtils";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

function flowSinkInMethod(scene: Scene, sinkStmt: any, methodName: string): boolean {
    const method = scene.getMethods().find(m => m.getName() === methodName);
    const cfg = method?.getCfg();
    return !!cfg && cfg.getStmts().includes(sinkStmt);
}

function findMethod(scene: Scene, methodName: string, signatureHint: string): any {
    const method = scene.getMethods().find(m =>
        m.getName?.() === methodName
        && m.getSignature?.().toString?.().includes(signatureHint)
    );
    assert(method, `method not found: ${methodName} (${signatureHint})`);
    return method;
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

    const transferEffect = exactTransferRule({
        id: "transfer.precision.inline_payload_box.to_bucket",
        method: findMethod(scene, "toBucket", "InlinePayloadBox"),
        from: "base",
        to: "result",
    });
    const sinkArg0Effect = exactSinkRule({
        id: "sink.precision.inline_db.update.arg0",
        family: "sink.precision.inline_db.update",
        method: findMethod(scene, "update", "InlineDb"),
        target: "arg0",
    });
    const sinkArg1Effect = exactSinkRule({
        id: "sink.precision.inline_db.update.arg1.no_flow",
        family: "sink.precision.inline_db.update",
        method: findMethod(scene, "update", "InlineDb"),
        target: "arg1",
    });
    const transferRules: TransferRule[] = [transferEffect.rule];
    const sinkRules: SinkRule[] = [sinkArg0Effect.rule];
    const sameFamilyDifferentEndpointSinkRules: SinkRule[] = [sinkArg1Effect.rule, ...sinkRules];
    const allFixtures = [transferEffect, sinkArg0Effect, sinkArg1Effect];

    const detect = async (
        rules: TransferRule[],
        sinks: SinkRule[] = sinkRules,
        fixtures: Array<ExactRuleFixture<TransferRule | SinkRule>> = allFixtures,
    ) => {
        const engine = new TaintPropagationEngine(scene, 1, {
            transferRules: rules,
            ...exactRuleRuntimeFromFixtures(fixtures),
        });
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
    const withSameFamilyDifferentEndpoint = await detect(transferRules, sameFamilyDifferentEndpointSinkRules);

    console.log("====== Sink Inline Transfer Payload Test ======");
    console.log(`seed_count=${withTransfer.seedCount}`);
    console.log(`without_transfer_flow_count=${withoutTransfer.flows.length}`);
    console.log(`with_transfer_flow_count=${withTransfer.flows.length}`);
    console.log(`with_same_family_different_endpoint_count=${withSameFamilyDifferentEndpoint.flows.length}`);
    console.log(`flow_sources=${withTransfer.flows.map(flow => flow.source).join(",")}`);
    console.log(`flow_transfer_rules=${withTransfer.flows.map(flow => (flow.transferRuleIds || []).join("+") || "<none>").join(",")}`);

    assert(withoutTransfer.flows.length === 0, "inline payload sink must not be detected without a matching transfer model");
    assert(withTransfer.flows.length >= 1, "expected inline transfer result passed to sink arg0 to be detected");
    assert(withSameFamilyDifferentEndpoint.flows.length >= 1,
        "a same-family rule with no flow must not suppress another rule that detects a different endpoint");
    assert(withSameFamilyDifferentEndpoint.flows.some(flow => flow.sinkEndpoint === "arg0"),
        "same-family selection must stay endpoint-scoped so the payload endpoint remains reportable");
    assert(withTransfer.flows.some(flow => flow.sinkEndpoint === "arg0"), "expected sink endpoint arg0");
    assert(withTransfer.flows.some(flow => (flow.transferRuleIds || []).includes("transfer.precision.inline_payload_box.to_bucket")),
        "expected detected flow to carry the inline transfer rule id");
}

main().catch(err => {
    console.error(err);
    process.exitCode = 1;
});
