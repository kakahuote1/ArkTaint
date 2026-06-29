import * as path from "path";
import { loadRuleSet } from "../../core/rules/RuleLoader";
import { SinkRule, TransferRule } from "../../core/rules/RuleSchema";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

function findSinkRuleByCanonicalId(rules: SinkRule[], canonicalApiId: string, target?: string): SinkRule {
    const rule = rules.find(item => item.match.kind === "canonical_api_id_equals"
        && item.match.value === canonicalApiId
        && (target === undefined || item.target === target));
    assert(rule, `missing canonical sink rule: ${canonicalApiId}${target ? ` target=${target}` : ""}`);
    return rule;
}

function assertMissingSinkRule(rules: SinkRule[], id: string): void {
    assert(
        !rules.some(item => item.id === id),
        `unsupported sink rule must not be present without official SDK inventory evidence: ${id}`,
    );
}

function findTransferRuleByCanonicalId(rules: TransferRule[], canonicalApiId: string): TransferRule {
    const rule = rules.find(item => item.match.kind === "canonical_api_id_equals" && item.match.value === canonicalApiId);
    assert(rule, `missing canonical transfer rule: ${canonicalApiId}`);
    return rule;
}

function assertCanonicalRule(
    rule: SinkRule | TransferRule,
    canonicalApiId: string,
    role: "sink" | "transfer",
    family: string,
): void {
    assert(rule.family === family, `${rule.id} should keep its semantic family`);
    assert(rule.match.kind === "canonical_api_id_equals", `${rule.id} must use canonical API identity`);
    assert(rule.match.value === canonicalApiId, `${rule.id} canonical API identity mismatch`);
    assert(rule.apiEffect?.role === role, `${rule.id} must keep ${role} apiEffect role`);
    assert(rule.apiEffect?.canonicalApiId === canonicalApiId, `${rule.id} apiEffect must bind the same canonical API`);
    assert(typeof rule.apiEffect.assetId === "string" && rule.apiEffect.assetId.length > 0, `${rule.id} must bind an asset`);
    assert(typeof rule.apiEffect.bindingId === "string" && rule.apiEffect.bindingId.length > 0, `${rule.id} must bind an asset binding`);
}

async function main(): Promise<void> {
    const loaded = loadRuleSet({
        ruleCatalogPath: path.resolve("src/models"),
        autoDiscoverRuleSources: false,
        allowMissingProject: true,
        allowMissingCandidate: true,
    });

    const sinks = loaded.ruleSet.sinks || [];
    const transfers = loaded.ruleSet.transfers || [];

    const hiLogExactCanonicalApiId = "api:official:openharmony:module=%40ohos.hilog:file=api%2F%40ohos.hilog.d.ts:export=default%3Ahilog:decl=namespace%3Ahilog:member=function%3Ainfo:invoke=call:params=0%3Anumber%2C1%3Astring%2C2%3Astring%2C3%3Arest%3Aany%5B%5D:ret=void";
    const hiLogExact = findSinkRuleByCanonicalId(sinks, hiLogExactCanonicalApiId, "arg3");
    assertCanonicalRule(
        hiLogExact,
        hiLogExactCanonicalApiId,
        "sink",
        "log-sink",
    );

    assert(
        !sinks.some(item => item.id.includes(".sig")),
        "kernel sinks must not retain legacy signature fallback ids",
    );

    const routerPushUrlCanonicalApiId = "api:official:openharmony:module=%40ohos.router:file=api%2F%40ohos.router.d.ets:export=default%3Arouter:decl=namespace%3Arouter:member=function%3ApushUrl:invoke=call:params=0%3ARouterOptions:ret=Promise%3Cvoid%3E";
    const routerBase = findSinkRuleByCanonicalId(sinks, routerPushUrlCanonicalApiId, "arg0");
    assertCanonicalRule(
        routerBase,
        routerPushUrlCanonicalApiId,
        "sink",
        "navigation-ability-handoff",
    );

    assertMissingSinkRule(sinks, "sink.harmony.sms.sendMessage");
    assertMissingSinkRule(sinks, "sink.harmony.bt.sppWrite");
    assertMissingSinkRule(sinks, "sink.harmony.bt.sppWriteAsync");
    assertMissingSinkRule(
        sinks,
        "sink.harmony.socket.send.arg0.for.sink.harmony.socket.send.arg0.0.exact.send.class.TCPSocket",
    );
    assertMissingSinkRule(
        sinks,
        "sink.harmony.request.upload.arg1.for.sink.harmony.request.upload.arg1.0.exact.upload.class.UploadTask",
    );

    const socketSend = findSinkRuleByCanonicalId(
        sinks,
        "api:official:openharmony:module=%40ohos.net.socket:file=api%2F%40ohos.net.socket.d.ts:export=namespace%3Asocket.TCPSocketConnection:decl=interface%3Asocket.TCPSocketConnection:member=method%3Ainstance%3Asend:invoke=call:params=0%3ATCPSendOptions:ret=Promise%3Cvoid%3E",
    );
    assertCanonicalRule(
        socketSend,
        "api:official:openharmony:module=%40ohos.net.socket:file=api%2F%40ohos.net.socket.d.ts:export=namespace%3Asocket.TCPSocketConnection:decl=interface%3Asocket.TCPSocketConnection:member=method%3Ainstance%3Asend:invoke=call:params=0%3ATCPSendOptions:ret=Promise%3Cvoid%3E",
        "sink",
        "network-source-sink",
    );

    const requestUpload = findSinkRuleByCanonicalId(
        sinks,
        "api:official:openharmony:module=%40ohos.request:file=api%2F%40ohos.request.d.ts:export=default%3Arequest:decl=namespace%3Arequest:member=function%3AuploadFile:invoke=call:params=0%3ABaseContext%2C1%3AUploadConfig:ret=Promise%3CUploadTask%3E",
    );
    assertCanonicalRule(
        requestUpload,
        "api:official:openharmony:module=%40ohos.request:file=api%2F%40ohos.request.d.ts:export=default%3Arequest:decl=namespace%3Arequest:member=function%3AuploadFile:invoke=call:params=0%3ABaseContext%2C1%3AUploadConfig:ret=Promise%3CUploadTask%3E",
        "sink",
        "network-source-sink",
    );

    const jsonStringifyExactCanonicalApiId = "api:official:tsjs:module=typescript%2Flib%2Flib.es5.d.ts:file=typescript%2Flib%2Flib.es5.d.ts:export=interface%3AJSON:decl=interface%3AJSON:member=method%3Ainstance%3Astringify:invoke=call:params=0%3Aany%2C1%3A%3F%3A(this%3A%20any%2C%20key%3A%20string%2C%20value%3A%20any)%20%3D%3E%20any%2C2%3A%3F%3Astring%20%7C%20number:ret=string";
    const jsonStringifyExact = findTransferRuleByCanonicalId(
        transfers,
        jsonStringifyExactCanonicalApiId,
    );
    assertCanonicalRule(
        jsonStringifyExact,
        jsonStringifyExactCanonicalApiId,
        "transfer",
        "json",
    );

    assert(
        !transfers.some(item => item.id.includes(".sig")),
        "kernel transfers must not retain legacy signature fallback ids",
    );

    console.log("====== Rule Family Framework Auto-Inference ======");
    console.log("framework_sink_family_identity=PASS");
    console.log("framework_transfer_family_identity=PASS");
}

main().catch(error => {
    console.error("FAIL test_rule_governance_framework_autoinference");
    console.error(error);
    process.exit(1);
});

