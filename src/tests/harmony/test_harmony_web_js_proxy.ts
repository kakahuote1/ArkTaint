import { buildTestScene } from "../helpers/TestSceneBuilder";
import { resolveKnownOptionCallbackRegistrationsFromStmt } from "../../core/substrate/semantics/KnownOptionCallbackRegistration";
import { TaintPropagationEngine } from "../../core/orchestration/TaintPropagationEngine";
import { SinkRule, SourceRule } from "../../core/rules/RuleSchema";
import { loadRuleSet } from "../../core/rules/RuleLoader";
import { projectApiEffectAssetFromMethod } from "../helpers/ApiEffectTestAssets";
import * as path from "path";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

function findMethodByName(scene: any, name: string): any {
    return scene.getMethods().find((method: any) => method.getName?.() === name);
}

async function main(): Promise<void> {
    const sourceDir = path.resolve("tests/demo/harmony_web_js_proxy");
    const scene = buildTestScene(sourceDir);
    const entryMethod = findMethodByName(scene, "web_js_proxy_001_T");
    assert(entryMethod, "expected test entry method");

    const callbackSignatures: string[] = [];
    for (const method of scene.getMethods()) {
        const cfg = method.getCfg?.();
        if (!cfg) continue;
        for (const stmt of cfg.getStmts?.() || []) {
            const invokeExpr = stmt.getInvokeExpr?.();
            const methodName = invokeExpr?.getMethodSignature?.()?.getMethodSubSignature?.()?.getMethodName?.() || "";
            if (methodName !== "javaScriptProxy") continue;
            for (const registration of resolveKnownOptionCallbackRegistrationsFromStmt(stmt, scene, method)) {
                callbackSignatures.push(registration.callbackMethod.getSignature?.()?.toString?.() || "");
            }
        }
    }

    assert(
        callbackSignatures.some(signature => signature.includes("callbackhtml")),
        `expected javaScriptProxy methodList callbackhtml to resolve, got ${callbackSignatures.join(", ")}`,
    );
    assert(
        !callbackSignatures.some(signature => signature.includes("notExposed")),
        `javaScriptProxy must not resolve methods absent from methodList: ${callbackSignatures.join(", ")}`,
    );

    const loaded = loadRuleSet({
        kernelRulePath: path.resolve("tests/rules/minimal.rules.json"),
        ruleCatalogPath: path.resolve("src/models"),
        autoDiscoverRuleSources: false,
        allowMissingProject: true,
        allowMissingCandidate: true,
    });
    const sourceRules = (loaded.ruleSet.sources || [])
        .filter((rule: SourceRule) => rule.family === "source.harmony.callback.web.js_proxy");
    assert(sourceRules.length > 0, "expected Web JS proxy callback source family");

    const sinkEffect = projectApiEffectAssetFromMethod({
        id: "sink.fixture.web.bridge",
        role: "sink",
        method: findMethodByName(scene, "Sink"),
        endpoint: { base: { kind: "arg", index: 0 } },
        sinkKind: "test",
    });
    const sinkRules: SinkRule[] = [
        {
            id: "sink.fixture.web.bridge",
            enabled: true,
            match: { kind: "canonical_api_id_equals", value: sinkEffect.canonicalApiDescriptor.canonicalApiId },
            apiEffect: sinkEffect.apiEffect,
            target: { endpoint: "arg0" },
        },
    ];

    const engine = new TaintPropagationEngine(scene, 1, { apiAssets: [sinkEffect.asset] });
    engine.verbose = false;
    await engine.buildPAG({
        entryModel: "explicit",
        syntheticEntryMethods: [entryMethod],
    });
    const seedInfo = engine.propagateWithSourceRules(sourceRules);
    const flows = engine.detectSinksByRules(sinkRules);

    assert(seedInfo.seedCount > 0, "expected javaScriptProxy callback parameter source seed");
    assert(flows.length > 0, "expected javaScriptProxy callback parameter to reach sink");

    console.log("PASS test_harmony_web_js_proxy");
    console.log(`callbacks=${callbackSignatures.length}`);
    console.log(`seed_count=${seedInfo.seedCount}`);
    console.log(`flows=${flows.length}`);
}

main().catch(error => {
    console.error("FAIL test_harmony_web_js_proxy");
    console.error(error);
    process.exitCode = 1;
});
