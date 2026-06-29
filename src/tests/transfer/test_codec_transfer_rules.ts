import * as path from "path";
import { TaintPropagationEngine } from "../../core/orchestration/TaintPropagationEngine";
import { PagNode } from "../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import { SinkRule, TransferRule } from "../../core/rules/RuleSchema";
import { buildTestScene } from "../helpers/TestSceneBuilder";
import { exactSinkRule, exactTransferRule } from "../rules/ExactRuleTestUtils";
import {
    assertCanonicalExactRules,
    exactTransferRuntimeFromFixtures,
} from "./ExactTransferTestUtils";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

function findMethod(scene: ReturnType<typeof buildTestScene>, methodName: string): any {
    return scene.getMethods().find(method => method.getName() === methodName);
}

function findRequiredMethod(scene: ReturnType<typeof buildTestScene>, methodName: string): any {
    const method = findMethod(scene, methodName);
    assert(method, `method not found: ${methodName}`);
    return method;
}

function buildSinkRules(scene: ReturnType<typeof buildTestScene>): {
    rules: SinkRule[];
    fixture: ReturnType<typeof exactSinkRule>;
} {
    const sinkEffect = exactSinkRule({
        id: "sink.codec.output",
        method: findRequiredMethod(scene, "Sink"),
        target: "arg0",
    });
    return {
        fixture: sinkEffect,
        rules: [sinkEffect.rule],
    };
}

function flowSinkInCaseMethod(scene: ReturnType<typeof buildTestScene>, sinkStmt: any, caseMethodName: string): boolean {
    const method = findMethod(scene, caseMethodName);
    if (!method) return false;
    const cfg = method.getCfg();
    if (!cfg) return false;
    return cfg.getStmts().includes(sinkStmt);
}

function findSeedNodes(
    engine: TaintPropagationEngine,
    scene: ReturnType<typeof buildTestScene>,
    methodName: string,
    localName: string,
): PagNode[] {
    const method = findRequiredMethod(scene, methodName);
    const local = method.getBody?.()?.getLocals?.()?.get(localName);
    if (local) {
        const nodeIds = engine.pag.getNodesByValue(local);
        if (nodeIds) return [...nodeIds.values()].map(id => engine.pag.getNode(id) as PagNode);
    }
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

function buildTransferRules(scene: ReturnType<typeof buildTestScene>): {
    rules: TransferRule[];
    fixtures: Array<ReturnType<typeof exactTransferRule>>;
} {
    const encode = exactTransferRule({
        id: "transfer.codec.text_encoder.encodeInto.arg0_to_result",
        method: findRequiredMethod(scene, "encodeInto"),
        from: "arg0",
        to: "result",
    });
    const decode = exactTransferRule({
        id: "transfer.codec.text_decoder.decodeToString.arg0_to_result",
        method: findRequiredMethod(scene, "decodeToString"),
        from: "arg0",
        to: "result",
    });
    return {
        fixtures: [encode, decode],
        rules: [encode.rule, decode.rule],
    };
}

async function detect(transferRules: TransferRule[]): Promise<boolean> {
    const scene = buildTestScene("tests/demo/harmony_wearengine_p2p");
    const entry = findMethod(scene, "wearengine_text_codec_003_T");
    assert(entry, "entry method not found for codec case");

    const sinkRules = buildSinkRules(scene);
    const transferFixtures = buildTransferRules(scene);
    const selectedTransferFixtures = transferRules.length === 0 ? [] : transferFixtures.fixtures;
    assertCanonicalExactRules([...sinkRules.rules, ...transferRules]);
    const exactRuntime = exactTransferRuntimeFromFixtures([
        sinkRules.fixture,
        ...selectedTransferFixtures,
    ]);
    const engine = new TaintPropagationEngine(scene, 1, {
        ...exactRuntime,
        transferRules,
        includeBuiltinModules: false,
    });
    engine.verbose = false;
    await engine.buildPAG({
        entryModel: "explicit",
        syntheticEntryMethods: [entry],
    });
    engine.setActiveReachableMethodSignatures(undefined, { mergeExplicitEntryScope: false });
    const seedNodes = findSeedNodes(engine, scene, "wearengine_text_codec_003_T", "userInput");
    assert(seedNodes.length > 0, "expected userInput seed");
    engine.propagateWithSeeds(seedNodes);
    const flows = engine.detectSinksByRules(sinkRules.rules);
    return flows.some(flow => flowSinkInCaseMethod(scene, flow.sink, "wearengine_text_codec_003_T"));
}

async function main(): Promise<void> {
    const scene = buildTestScene("tests/demo/harmony_wearengine_p2p");
    const codecTransfers = buildTransferRules(scene).rules;
    assert(codecTransfers.length === 2, "expected codec transfer rules to load");
    assertCanonicalExactRules(codecTransfers);

    const withRules = await detect(codecTransfers);
    const withoutRules = await detect([]);
    assert(withRules, "expected codec transfer rules to preserve taint through encode/decode");
    assert(!withoutRules, "expected no codec flow without transfer rules");

    console.log("PASS test_codec_transfer_rules");
    console.log(`codec_transfer_rules=${codecTransfers.length}`);
}

main().catch(error => {
    console.error("FAIL test_codec_transfer_rules");
    console.error(error);
    process.exit(1);
});
