import {
    buildSemanticFlowArtifact,
    buildSemanticFlowAnalysisAugment,
} from "../../core/semanticflow/SemanticFlowArtifacts";
import { compileModuleSpec } from "../../core/orchestration/modules/ModuleSpecCompiler";
import type { SemanticFlowItemResult, SemanticFlowSummary } from "../../core/semanticflow/SemanticFlowTypes";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

function transferSummary(): SemanticFlowSummary {
    return {
        inputs: [{ slot: "arg", index: 0 }],
        outputs: [{ slot: "result" }],
        transfers: [{ from: { slot: "arg", index: 0 }, to: { slot: "result" }, relation: "direct" }],
        confidence: "high",
        ruleKind: "transfer",
    };
}

function sinkSummary(): SemanticFlowSummary {
    return {
        inputs: [{ slot: "arg", index: 0 }],
        outputs: [],
        transfers: [],
        confidence: "high",
        ruleKind: "sink",
    };
}

function returnSourceSummary(): SemanticFlowSummary {
    return {
        inputs: [],
        outputs: [{ slot: "result" }],
        transfers: [],
        confidence: "high",
        ruleKind: "source",
    };
}

function bridgeSummary(): SemanticFlowSummary {
    return {
        inputs: [{ surface: "publish", slot: "arg", index: 1 }],
        outputs: [{ surface: "bind", slot: "callback_param", callbackArgIndex: 0, paramIndex: 0 }],
        transfers: [{
            from: { surface: "publish", slot: "arg", index: 1 },
            to: { surface: "bind", slot: "callback_param", callbackArgIndex: 0, paramIndex: 0 },
            relation: "deferred",
        }],
        confidence: "high",
        moduleKind: "deferred",
        relations: {
            trigger: {
                preset: "callback_event",
            },
        },
    };
}

function callbackBridgeSummaryWithFunctionVia(): SemanticFlowSummary {
    return {
        inputs: [{ slot: "arg", index: 0 }, { slot: "arg", index: 1 }],
        outputs: [{ slot: "callback_param", callbackArgIndex: 0, paramIndex: 0 }],
        transfers: [{
            from: { slot: "arg", index: 1 },
            to: { slot: "callback_param", callbackArgIndex: 0, paramIndex: 0 },
        }],
        confidence: "high",
        moduleKind: "bridge",
        relations: {
            trigger: {
                preset: "callback_sync",
                via: { slot: "arg", index: 1 },
                reason: "callback function argument is invoked synchronously",
            },
        },
    };
}

function decoratedFieldBridgeSummary(): SemanticFlowSummary {
    return {
        inputs: [{ slot: "arg", index: 0, fieldPath: ["parameters", "token"] }],
        outputs: [{ slot: "base", fieldPath: ["storage", "token"] }],
        transfers: [{
            from: { slot: "arg", index: 0, fieldPath: ["parameters", "token"] },
            to: { slot: "base", fieldPath: ["storage", "token"] },
        }],
        confidence: "high",
        moduleKind: "bridge",
        relations: {
            carrier: { kind: "state", label: "this.storage" },
        },
    };
}

async function main(): Promise<void> {
    const ruleA = buildSemanticFlowArtifact({
        id: "rule.alpha.cloneValue",
        owner: "AlphaPipe",
        surface: "cloneValue",
        methodSignature: "@a: AlphaPipe.cloneValue(string)",
    }, transferSummary(), "rule");
    const ruleB = buildSemanticFlowArtifact({
        id: "rule.beta.cloneValue",
        owner: "BetaPipe",
        surface: "cloneValue",
        methodSignature: "@b: BetaPipe.cloneValue(string)",
    }, transferSummary(), "rule");

    assert(ruleA.kind === "rule" && ruleB.kind === "rule", "expected rule artifacts");
    const ruleAId = ruleA.ruleSet.transfers[0]?.id;
    const ruleBId = ruleB.ruleSet.transfers[0]?.id;
    assert(ruleAId !== ruleBId, `same-surface rules must not share ids: ${ruleAId}`);

    const restSink = buildSemanticFlowArtifact({
        id: "rule.logger.info",
        owner: "Logger",
        surface: "info",
        methodSignature: "@ets/common/utils/Logger.ets: Logger.info(string[])",
    }, sinkSummary(), "rule");
    assert(restSink.kind === "rule", "expected rest sink rule artifact");
    assert(restSink.ruleSet.sinks.length === 1, "expected one rest sink rule");
    assert(restSink.ruleSet.sinks[0].target === "arg0", "rest-array sink should stay bound to the rest formal instead of widening to any argument");

    const recalledSource = buildSemanticFlowArtifact({
        id: "rule.project.servicer.getCredential.source",
        owner: "Servicer",
        surface: "getUserCredential",
        methodSignature: "@entry/src/main/ets/configure/service.ets: Servicer.[static]getUserCredential(Unknown)",
        filePath: "entry/src/main/ets/configure/service.ets",
        metaTags: ["rule", "candidate", "static", "focus-returned_value_surface"],
    }, returnSourceSummary(), "rule");
    assert(recalledSource.kind === "rule", "expected recalled return source artifact");
    const recalledSourceRule = recalledSource.ruleSet.sources[0];
    assert(recalledSourceRule.match.kind === "method_name_equals", "Unknown recalled source should not use brittle signature_equals");
    assert(recalledSourceRule.match.value === "getUserCredential", "expected stable method name match");
    assert(recalledSourceRule.match.invokeKind === "static", "expected static invoke shape");
    assert(recalledSourceRule.match.argCount === 1, "expected parsed argument count");
    assert(recalledSourceRule.calleeScope?.className?.value === "Servicer", "source call_return should scope the callee class");
    assert(!recalledSourceRule.scope, "source call_return should not scope the caller method");

    const recalledSourceWithWrongKind = buildSemanticFlowArtifact({
        id: "rule.project.servicer.getProfile.source.kind.normalize",
        owner: "Servicer",
        surface: "getUserProfile",
        methodSignature: "@entry/src/main/ets/configure/service.ets: Servicer.[static]getUserProfile(Unknown)",
        filePath: "entry/src/main/ets/configure/service.ets",
        metaTags: ["rule", "candidate", "static", "focus-returned_value_surface"],
    }, {
        inputs: [],
        outputs: [{ slot: "result" }],
        transfers: [],
        confidence: "medium",
        ruleKind: "source",
        sourceKind: "field_read",
    }, "rule");
    assert(recalledSourceWithWrongKind.kind === "rule", "expected source artifact with normalized kind");
    assert(
        recalledSourceWithWrongKind.ruleSet.sources[0].sourceKind === "call_return",
        "artifact builder should normalize sourceKind to match the returned-value output slot",
    );

    const recalledZeroArgReturnSource = buildSemanticFlowArtifact({
        id: "rule.project.tokenstore.loadToken.source",
        owner: "TokenStoreRepository",
        surface: "loadToken",
        methodSignature: "@core/data/src/main/ets/repository/TokenStoreRepository.ets: TokenStoreRepository.loadToken()",
        filePath: "core/data/src/main/ets/repository/TokenStoreRepository.ets",
        metaTags: ["api-modeling-candidate", "instance", "focus-returned_value_surface"],
    }, returnSourceSummary(), "rule");
    assert(recalledZeroArgReturnSource.kind === "rule", "expected zero-argument returned-value source artifact");
    const recalledZeroArgReturnSourceRule = recalledZeroArgReturnSource.ruleSet.sources[0];
    assert(recalledZeroArgReturnSourceRule.match.kind === "method_name_equals", "api-modeling candidates should avoid brittle signature_equals even for zero-argument returns");
    assert(recalledZeroArgReturnSourceRule.match.value === "loadToken", "zero-argument returned-value source should keep stable surface name");
    assert(recalledZeroArgReturnSourceRule.match.argCount === 0, "zero-argument returned-value source should preserve arg count");
    assert(recalledZeroArgReturnSourceRule.match.invokeKind === "instance", "zero-argument returned-value source should preserve invoke kind");
    assert(recalledZeroArgReturnSourceRule.calleeScope?.className?.value === "TokenStoreRepository", "zero-argument returned-value source should scope the callee class");

    const recalledSink = buildSemanticFlowArtifact({
        id: "rule.project.servicer.getProfile.sink",
        owner: "Servicer",
        surface: "getUserProfile",
        methodSignature: "@entry/src/main/ets/configure/service.ets: Servicer.[static]getUserProfile(Unknown)",
        filePath: "entry/src/main/ets/configure/service.ets",
        metaTags: ["rule", "candidate", "static"],
    }, sinkSummary(), "rule");
    assert(recalledSink.kind === "rule", "expected recalled sink artifact");
    const recalledSinkRule = recalledSink.ruleSet.sinks[0];
    assert(recalledSinkRule.match.kind === "method_name_equals", "Unknown recalled sink should not use brittle signature_equals");
    assert(recalledSinkRule.match.argCount === 1, "expected recalled sink argument count");
    assert(recalledSinkRule.scope?.className?.value === "Servicer", "sink should scope the invoked class");

    const overwideSink = buildSemanticFlowArtifact({
        id: "rule.generated.sdk.getLogEntries.sink",
        owner: "ActivityLogApi",
        surface: "getLogEntries",
        methodSignature: "@library/src/main/ets/generated-client/api/activity-log-api.ts: ActivityLogApi.getLogEntries(Unknown, Unknown)",
        filePath: "library/src/main/ets/generated-client/api/activity-log-api.ts",
        metaTags: ["api-modeling-candidate", "instance"],
    }, {
        inputs: [
            { slot: "arg", index: 0 },
            { slot: "arg", index: 1 },
            { slot: "arg", index: 2 },
            { slot: "arg", index: 3 },
        ],
        outputs: [],
        transfers: [],
        confidence: "medium",
        ruleKind: "sink",
    }, "rule");
    assert(overwideSink.kind === "rule", "expected overwide sink artifact");
    assert(overwideSink.ruleSet.sinks.length === 2, "artifact builder should discard sink inputs that exceed the method arity");
    assert(overwideSink.ruleSet.sinks.every(rule => rule.target === "arg0" || rule.target === "arg1"),
        "artifact builder should keep only representable sink input slots");

    const projectLocalSink = buildSemanticFlowArtifact({
        id: "rule.project.appevent.createUser.sink",
        owner: "AppEvent",
        surface: "createUser",
        methodSignature: "@entry/src/main/ets/globals/event.ets: AppEvent.createUser(IUser)",
        filePath: "entry/src/main/ets/globals/event.ets",
        metaTags: ["rule", "candidate", "instance"],
    }, sinkSummary(), "rule");
    assert(projectLocalSink.kind === "rule", "expected project local sink artifact");
    const projectLocalSinkRule = projectLocalSink.ruleSet.sinks[0];
    assert(projectLocalSinkRule.match.kind === "method_name_equals", "project local candidates should avoid brittle signature_equals even with concrete local types");
    assert(projectLocalSinkRule.match.argCount === 1, "project local method rule should preserve argument count");
    assert(projectLocalSinkRule.match.invokeKind === "instance", "project local method rule should preserve invoke kind");
    assert(projectLocalSinkRule.scope?.className?.value === "AppEvent", "project local sink should be scoped by owner class");

    const projectLocalTransfer = buildSemanticFlowArtifact({
        id: "rule.project.user.from.transfer",
        owner: "User",
        surface: "from",
        methodSignature: "@entry/src/main/ets/models/user.ets: User.[static]from(Partial<IUser>)",
        filePath: "entry/src/main/ets/models/user.ets",
        metaTags: ["rule", "candidate", "static"],
    }, transferSummary(), "rule");
    assert(projectLocalTransfer.kind === "rule", "expected project local transfer artifact");
    const projectLocalTransferRule = projectLocalTransfer.ruleSet.transfers[0];
    assert(projectLocalTransferRule.match.kind === "method_name_equals", "project local transfer should use method+scope matching");
    assert(projectLocalTransferRule.match.value === "from", "project local transfer should keep stable surface method name");
    assert(projectLocalTransferRule.match.argCount === 1, "project local transfer should parse local concrete parameter list");
    assert(projectLocalTransferRule.scope?.className?.value === "User", "project local transfer should be scoped by owner class");

    const methodCallbackSource = buildSemanticFlowArtifact({
        id: "rule.project.axios.interceptor.source",
        owner: "%unk",
        surface: "use",
        methodSignature: "@%unk/%unk: .use(Unknown, Unknown)",
        filePath: "entry/src/main/ets/configure/axios.ets",
        metaTags: ["rule", "candidate", "instance"],
        callbackArgIndexes: [0, 1],
        typeHint: "interceptors.response",
    }, {
        inputs: [],
        outputs: [{ slot: "callback_param", callbackArgIndex: 1, paramIndex: 0 }],
        transfers: [],
        confidence: "high",
        ruleKind: "source",
        sourceKind: "callback_param",
    }, "rule");
    assert(methodCallbackSource.kind === "rule", "expected method callback source artifact");
    const methodCallbackSourceRule = methodCallbackSource.ruleSet.sources[0];
    assert(methodCallbackSourceRule.match.kind === "method_name_equals", "method callback source should use stable method fallback");
    assert(methodCallbackSourceRule.match.value === "use", "method callback source should match the registration method");
    assert(methodCallbackSourceRule.match.invokeKind === "instance", "method callback source should preserve invoke kind");
    assert(methodCallbackSourceRule.match.argCount === 2, "method callback source should preserve registration arg count");
    assert(methodCallbackSourceRule.match.typeHint === "interceptors.response", "method callback source should keep receiver typeHint to avoid broad use(...) matching");
    assert(methodCallbackSourceRule.callbackArgIndexes?.[0] === 1, "method callback source should preserve selected callback arg index");
    assert(methodCallbackSourceRule.scope?.file?.value === "configure/axios.ets", "unknown method callback source should scope the registration caller file");
    assert(!methodCallbackSourceRule.calleeScope, "unknown method callback source should not scope the unknown external callee file");

    const moduleA = buildSemanticFlowArtifact({
        id: "module.alpha.publish",
        owner: "AlphaBus",
        surface: "publish",
    }, bridgeSummary(), "module");
    const moduleB = buildSemanticFlowArtifact({
        id: "module.beta.publish",
        owner: "BetaBus",
        surface: "publish",
    }, bridgeSummary(), "module");

    const callbackModule = buildSemanticFlowArtifact({
        id: "module.callback.handle",
        owner: "CallbackOwner",
        surface: "handle",
    }, callbackBridgeSummaryWithFunctionVia(), "module");
    assert(callbackModule.kind === "module", "expected callback bridge module artifact");
    compileModuleSpec(callbackModule.moduleSpec);

    const decoratedFieldModule = buildSemanticFlowArtifact({
        id: "module.decorated.field.write",
        owner: "StateOwner",
        surface: "restoreLocalStorage",
        methodSignature: "@a: StateOwner.restoreLocalStorage(Want)",
    }, decoratedFieldBridgeSummary(), "module");
    assert(decoratedFieldModule.kind === "module", "expected decorated field bridge module artifact");
    compileModuleSpec(decoratedFieldModule.moduleSpec);

    assert(moduleA.kind === "module" && moduleB.kind === "module", "expected module artifacts");
    assert(moduleA.moduleSpec.id !== moduleB.moduleSpec.id, "same-surface inferred modules must not share ids");

    const merged = buildSemanticFlowAnalysisAugment([
        {
            anchor: { id: "dup.rule", surface: "cloneValue", methodSignature: "@a: AlphaPipe.cloneValue(string)" },
            draftId: "draft.dup.rule",
            classification: "rule",
            resolution: "resolved",
            summary: transferSummary(),
            draft: transferSummary(),
            artifact: ruleA,
            finalSlice: { anchorId: "dup.rule", round: 0, template: "call-return", observations: [], snippets: [] },
            history: [],
        } satisfies SemanticFlowItemResult,
        {
            anchor: { id: "dup.rule.copy", surface: "cloneValue", methodSignature: "@a: AlphaPipe.cloneValue(string)" },
            draftId: "draft.dup.rule.copy",
            classification: "rule",
            resolution: "resolved",
            summary: transferSummary(),
            draft: transferSummary(),
            artifact: ruleA,
            finalSlice: { anchorId: "dup.rule.copy", round: 0, template: "call-return", observations: [], snippets: [] },
            history: [],
        } satisfies SemanticFlowItemResult,
    ]);

    assert(merged.ruleSet.transfers.length === 1, `duplicate rule ids should dedupe, got ${merged.ruleSet.transfers.length}`);

    const scopedSinkA = buildSemanticFlowArtifact({
        id: "rule.project.cacheA.write",
        owner: "CacheA",
        surface: "write",
        methodSignature: "@entry/src/main/ets/cache/a.ets: CacheA.write(string)",
        filePath: "entry/src/main/ets/cache/a.ets",
        metaTags: ["rule", "candidate", "instance"],
    }, sinkSummary(), "rule");
    const scopedSinkB = buildSemanticFlowArtifact({
        id: "rule.project.cacheB.write",
        owner: "CacheB",
        surface: "write",
        methodSignature: "@entry/src/main/ets/cache/b.ets: CacheB.write(string)",
        filePath: "entry/src/main/ets/cache/b.ets",
        metaTags: ["rule", "candidate", "instance"],
    }, sinkSummary(), "rule");
    const scopedMerged = buildSemanticFlowAnalysisAugment([
        {
            anchor: { id: "scoped.a", surface: "write" },
            draftId: "draft.scoped.a",
            classification: "rule",
            resolution: "resolved",
            summary: sinkSummary(),
            draft: sinkSummary(),
            artifact: scopedSinkA,
            finalSlice: { anchorId: "scoped.a", round: 0, template: "call-return", observations: [], snippets: [] },
            history: [],
        } satisfies SemanticFlowItemResult,
        {
            anchor: { id: "scoped.b", surface: "write" },
            draftId: "draft.scoped.b",
            classification: "rule",
            resolution: "resolved",
            summary: sinkSummary(),
            draft: sinkSummary(),
            artifact: scopedSinkB,
            finalSlice: { anchorId: "scoped.b", round: 0, template: "call-return", observations: [], snippets: [] },
            history: [],
        } satisfies SemanticFlowItemResult,
    ]);
    assert(scopedMerged.ruleSet.sinks.length === 2, `same method/target with different scopes must not dedupe, got ${scopedMerged.ruleSet.sinks.length}`);

    console.log("PASS test_semanticflow_artifact_ids");
}

main().catch(error => {
    console.error("FAIL test_semanticflow_artifact_ids");
    console.error(error);
    process.exit(1);
});
