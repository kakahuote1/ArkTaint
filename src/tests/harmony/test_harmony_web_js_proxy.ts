import { buildTestScene } from "../helpers/TestSceneBuilder";
import { resolveKnownOptionCallbackRegistrationsFromStmt } from "../../core/substrate/semantics/KnownOptionCallbackRegistration";
import { buildFrameworkCallbackSourceRules } from "../../core/rules/FrameworkCallbackSourceCatalog";
import { TaintPropagationEngine } from "../../core/orchestration/TaintPropagationEngine";
import { SinkRule, SourceRule } from "../../core/rules/RuleSchema";
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

    const sourceRules = buildFrameworkCallbackSourceRules()
        .filter((rule: SourceRule) => rule.family === "source.harmony.callback.web.js_proxy");
    assert(sourceRules.length > 0, "expected Web JS proxy callback source family");

    const sinkRules: SinkRule[] = [
        {
            id: "sink.fixture.web.bridge",
            enabled: true,
            match: { kind: "method_name_equals", value: "Sink" },
            target: { endpoint: "arg0" },
        },
    ];

    const engine = new TaintPropagationEngine(scene, 1);
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
