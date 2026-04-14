import * as path from "path";
import { loadRuleSet } from "../../core/rules/RuleLoader";
import { SinkRule, TransferRule } from "../../core/rules/RuleSchema";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

function findSinkRule(rules: SinkRule[], id: string): SinkRule {
    const rule = rules.find(item => item.id === id);
    assert(rule, `missing sink rule: ${id}`);
    return rule;
}

function findTransferRule(rules: TransferRule[], id: string): TransferRule {
    const rule = rules.find(item => item.id === id);
    assert(rule, `missing transfer rule: ${id}`);
    return rule;
}

async function main(): Promise<void> {
    const loaded = loadRuleSet({
        ruleCatalogPath: path.resolve("src/models"),
        autoDiscoverLayers: false,
        allowMissingProject: true,
        allowMissingCandidate: true,
    });

    const sinks = loaded.ruleSet.sinks || [];
    const transfers = loaded.ruleSet.transfers || [];

    const hiLogExact = findSinkRule(sinks, "sink.harmony.hilog.info.arg3.exact");
    assert(hiLogExact.family === "sink.harmony.logging.hilog_info", "hilog exact sink should infer hilog info family");
    assert(hiLogExact.tier === "A", "hilog exact sink should infer tier A");

    const hiLogSig = findSinkRule(sinks, "sink.harmony.hilog.info.arg3.sig");
    assert(hiLogSig.family === "sink.harmony.logging.hilog_info", "hilog signature sink should stay in hilog info family");
    assert(hiLogSig.tier === "C", "hilog signature sink should infer tier C");

    const routerBase = findSinkRule(sinks, "sink.harmony.router.pushUrl.arg0");
    assert(routerBase.family === "sink.harmony.router.pushUrl", "router pushUrl base sink should infer router family");
    assert(routerBase.tier === "B", "router pushUrl base sink should infer tier B");

    const routerSig = findSinkRule(sinks, "sink.harmony.router.pushUrl.arg0.sig");
    assert(routerSig.family === "sink.harmony.router.pushUrl", "router pushUrl signature sink should stay in router family");
    assert(routerSig.tier === "C", "router pushUrl signature sink should infer tier C");

    const smsSend = findSinkRule(sinks, "sink.harmony.sms.sendMessage");
    assert(smsSend.family === "sink.harmony.sms", "sms sink should infer sms family");
    assert(smsSend.tier === "B", "sms sink should infer tier B");

    const btWrite = findSinkRule(sinks, "sink.harmony.bt.sppWrite");
    assert(btWrite.family === "sink.harmony.bluetooth.spp", "bluetooth sink should infer bluetooth SPP family");
    assert(btWrite.tier === "B", "bluetooth sink should infer tier B");

    const jsonStringifyExact = findTransferRule(transfers, "transfer.harmony.json.stringify.arg0_to_result.exact");
    assert(
        jsonStringifyExact.family === "transfer.harmony.json.stringify",
        "json stringify exact transfer should infer stringify family",
    );
    assert(jsonStringifyExact.tier === "A", "json stringify exact transfer should infer tier A");

    const jsonStringifySig = findTransferRule(transfers, "transfer.harmony.json.stringify.arg0_to_result.sig");
    assert(
        jsonStringifySig.family === "transfer.harmony.json.stringify",
        "json stringify signature transfer should stay in stringify family",
    );
    assert(jsonStringifySig.tier === "C", "json stringify signature transfer should infer tier C");

    console.log("====== Rule Governance Framework Auto-Inference ======");
    console.log("framework_sink_family_tier=PASS");
    console.log("framework_transfer_family_tier=PASS");
}

main().catch(error => {
    console.error("FAIL test_rule_governance_framework_autoinference");
    console.error(error);
    process.exit(1);
});

