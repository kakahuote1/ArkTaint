import * as path from "path";
import { TaintPropagationEngine } from "../../core/orchestration/TaintPropagationEngine";
import { loadRuleSet } from "../../core/rules/RuleLoader";
import { SinkRule, SourceRule, TransferRule } from "../../core/rules/RuleSchema";
import { buildTestScene } from "../helpers/TestSceneBuilder";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

const SOURCE_RULES: SourceRule[] = [
    {
        id: "source.codec.userInput",
        match: { kind: "method_name_equals", value: "wearengine_text_codec_003_T" },
        sourceKind: "entry_param",
        target: "arg0",
    },
];

const SINK_RULES: SinkRule[] = [
    {
        id: "sink.codec.output",
        match: { kind: "method_name_equals", value: "Sink" },
        target: "arg0",
    },
];

function findMethod(scene: ReturnType<typeof buildTestScene>, methodName: string): any {
    return scene.getMethods().find(method => method.getName() === methodName);
}

function flowSinkInCaseMethod(scene: ReturnType<typeof buildTestScene>, sinkStmt: any, caseMethodName: string): boolean {
    const method = findMethod(scene, caseMethodName);
    if (!method) return false;
    const cfg = method.getCfg();
    if (!cfg) return false;
    return cfg.getStmts().includes(sinkStmt);
}

async function detect(transferRules: TransferRule[]): Promise<boolean> {
    const scene = buildTestScene("tests/demo/harmony_wearengine_p2p");
    const entry = findMethod(scene, "wearengine_text_codec_003_T");
    assert(entry, "entry method not found for codec case");

    const engine = new TaintPropagationEngine(scene, 1, { transferRules });
    engine.verbose = false;
    await engine.buildPAG({
        entryModel: "explicit",
        syntheticEntryMethods: [entry],
    });
    const seedInfo = engine.propagateWithSourceRules(SOURCE_RULES);
    assert(seedInfo.seedCount > 0, "expected userInput seed");
    const flows = engine.detectSinksByRules(SINK_RULES);
    return flows.some(flow => flowSinkInCaseMethod(scene, flow.sink, "wearengine_text_codec_003_T"));
}

async function main(): Promise<void> {
    const loaded = loadRuleSet({
        kernelRulePath: path.resolve("tests/rules/minimal.rules.json"),
        ruleCatalogPath: path.resolve("src/models"),
        autoDiscoverLayers: false,
        allowMissingProject: true,
    });
    const codecTransfers = (loaded.ruleSet.transfers || []).filter(rule =>
        String(rule.id || "").startsWith("transfer.harmony.text")
    );
    assert(codecTransfers.length >= 3, "expected codec transfer rules to load");

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
