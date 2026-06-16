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

function assertMissingSinkRule(rules: SinkRule[], id: string): void {
    assert(
        !rules.some(item => item.id === id),
        `unsupported sink rule must not be present without official SDK inventory evidence: ${id}`,
    );
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
    assert(hiLogExact.family === "sink.harmony.hilog.info", "hilog exact sink should infer hilog info family");
    assert(hiLogExact.tier === "A", "hilog exact sink should infer tier A");

    assert(
        !sinks.some(item => item.id.includes(".sig")),
        "kernel sinks must not retain legacy signature fallback ids",
    );

    const routerBase = findSinkRule(sinks, "sink.harmony.router.pushUrl.arg0");
    assert(routerBase.family === "sink.harmony.router.pushUrl", "router pushUrl base sink should infer router family");
    assert(routerBase.tier === "B", "router pushUrl base sink should infer tier B");

    assertMissingSinkRule(sinks, "sink.harmony.sms.sendMessage");
    assertMissingSinkRule(sinks, "sink.harmony.bt.sppWrite");
    assertMissingSinkRule(sinks, "sink.harmony.bt.sppWriteAsync");

    const socketSend = findSinkRule(
        sinks,
        "sink.harmony.socket.send.arg0.for.sink.harmony.socket.send.arg0.0.exact.send.class.TCPSocket",
    );
    assert(socketSend.family === "sink.harmony.network.socket", "socket send sink should infer socket family");
    assert(socketSend.tier === "B", "socket send sink should infer tier B from exact method scope");
    assert(socketSend.match.kind === "method_name_equals", "socket send sink must stay exact method match");
    assert(socketSend.match.value === "send", "socket send sink must match send exactly");

    const requestUpload = findSinkRule(
        sinks,
        "sink.harmony.request.upload.arg1.for.sink.harmony.request.upload.arg1.0.exact.upload.class.UploadTask",
    );
    assert(requestUpload.family === "sink.harmony.network.request", "request upload sink should infer request family");
    assert(requestUpload.tier === "B", "request upload sink should infer tier B from exact method scope");
    assert(requestUpload.match.kind === "method_name_equals", "request upload sink must stay exact method match");
    assert(requestUpload.match.value === "upload", "request upload sink must match upload exactly");

    const jsonStringifyExact = findTransferRule(
        transfers,
        "transfer.harmony.json.stringify.arg0_to_result.exact.stringify.className.JSON",
    );
    assert(
        jsonStringifyExact.family === "auto.transfer.transfer.method.stringify",
        "json stringify exact transfer should infer stable exact-method family",
    );
    assert(jsonStringifyExact.tier === "B", "json stringify exact transfer should infer tier B from exact method shape");
    assert(jsonStringifyExact.match.kind === "method_name_equals", "json stringify transfer must stay exact method match");
    assert(jsonStringifyExact.match.value === "stringify", "json stringify transfer must match stringify exactly");

    assert(
        !transfers.some(item => item.id.includes(".sig")),
        "kernel transfers must not retain legacy signature fallback ids",
    );

    console.log("====== Rule Governance Framework Auto-Inference ======");
    console.log("framework_sink_family_tier=PASS");
    console.log("framework_transfer_family_tier=PASS");
}

main().catch(error => {
    console.error("FAIL test_rule_governance_framework_autoinference");
    console.error(error);
    process.exit(1);
});

