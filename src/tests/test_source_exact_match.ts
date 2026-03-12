import { Scene } from "../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../arkanalyzer/out/src/Config";
import { TaintPropagationEngine } from "../core/TaintPropagationEngine";
import { SinkRule, SourceRule } from "../core/rules/RuleSchema";
import { validateRuleSet } from "../core/rules/RuleValidator";
import * as path from "path";

interface CaseSpec {
    name: string;
    expected: boolean;
}

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

function flowSinkInCaseMethod(scene: Scene, sinkStmt: any, caseMethodName: string): boolean {
    const method = scene.getMethods().find(m => m.getName() === caseMethodName);
    if (!method) return false;
    const cfg = method.getCfg();
    if (!cfg) return false;
    return cfg.getStmts().includes(sinkStmt);
}

async function runCase(
    scene: Scene,
    caseName: string,
    sourceRules: SourceRule[],
    sinkRules: SinkRule[]
): Promise<boolean> {
    const engine = new TaintPropagationEngine(scene, 1);
    engine.verbose = false;
    await engine.buildPAG();
    engine.propagateWithSourceRules(sourceRules);
    const flows = engine.detectSinksByRules(sinkRules);
    const scopedFlows = flows.filter(flow => flowSinkInCaseMethod(scene, flow.sink, caseName));
    return scopedFlows.length > 0;
}

function findMethodSignature(scene: Scene, methodName: string, signatureHint: string): string {
    const method = scene.getMethods().find(m =>
        m.getName() === methodName
        && m.getSignature().toString().includes(signatureHint)
    );
    assert(method, `method not found: ${methodName} (${signatureHint})`);
    return method.getSignature().toString();
}

async function main(): Promise<void> {
    const sourceDir = path.resolve("tests/demo/rule_precision_source");
    const sceneConfig = new SceneConfig();
    sceneConfig.buildFromProjectDir(sourceDir);
    const scene = new Scene();
    scene.buildSceneFromProjectDir(sceneConfig);
    scene.inferTypes();

    const sourceReturnSig = findMethodSignature(scene, "SourceReturn", "taint_mock");
    const sourceArgSig = findMethodSignature(scene, "SourceArg", "taint_mock");

    const sourceRules: SourceRule[] = [
        {
            id: "source.exact.signature_equals.call_return",
            kind: "call_return",
            target: "result",
            targetRef: { endpoint: "result" },
            match: { kind: "signature_equals", value: sourceReturnSig },
        },
        {
            id: "source.exact.callee_signature_equals.call_arg",
            kind: "call_arg",
            target: "arg1",
            targetRef: { endpoint: "arg1" },
            match: { kind: "callee_signature_equals", value: sourceArgSig },
            argCount: 2,
        },
    ];

    const sinkRules: SinkRule[] = [
        {
            id: "sink.exact.arg0",
            profile: "signature",
            sinkTarget: "arg0",
            sinkTargetRef: { endpoint: "arg0" },
            match: { kind: "method_name_equals", value: "Sink" },
        },
    ];

    const validation = validateRuleSet({
        schemaVersion: "1.1",
        sources: sourceRules,
        sinks: sinkRules,
        transfers: [],
    });
    assert(validation.valid, `source exact-match rules invalid: ${validation.errors.join("; ")}`);

    const cases: CaseSpec[] = [
        { name: "source_call_return_001_T", expected: true },
        { name: "source_call_return_002_F", expected: false },
        { name: "source_call_arg_003_T", expected: true },
        { name: "source_call_arg_004_F", expected: false },
    ];

    let passCount = 0;
    for (const c of cases) {
        const detectedWithRules = await runCase(scene, c.name, sourceRules, sinkRules);
        const detectedWithoutRules = await runCase(scene, c.name, [], sinkRules);
        const pass = c.expected
            ? (detectedWithRules && !detectedWithoutRules)
            : !detectedWithRules;
        if (pass) passCount++;

        console.log(
            `${pass ? "PASS" : "FAIL"} ${c.name} expected=${c.expected ? "T" : "F"} `
            + `withRules=${detectedWithRules} withoutRules=${detectedWithoutRules}`
        );
    }

    console.log("====== Source Exact Match Test ======");
    console.log(`total_cases=${cases.length}`);
    console.log(`pass_cases=${passCount}`);
    console.log(`fail_cases=${cases.length - passCount}`);

    if (passCount !== cases.length) {
        process.exitCode = 1;
    }
}

main().catch(err => {
    console.error(err);
    process.exitCode = 1;
});

