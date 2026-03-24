import { Scene } from "../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../arkanalyzer/out/src/Config";
import { TaintPropagationEngine } from "../core/orchestration/TaintPropagationEngine";
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

function findDeclaringClassSignature(scene: Scene, className: string, methodName: string): string {
    const method = scene.getMethods().find(m =>
        m.getName() === methodName
        && m.getDeclaringArkClass?.()?.getName?.() === className
    );
    assert(method, `method not found for class signature: ${className}.${methodName}`);
    const classSignature = method.getDeclaringArkClass()?.getSignature?.()?.toString?.();
    assert(classSignature && classSignature.length > 0, `class signature missing: ${className}.${methodName}`);
    return classSignature;
}

async function main(): Promise<void> {
    const sourceDir = path.resolve("tests/demo/rule_precision_sink");
    const sceneConfig = new SceneConfig();
    sceneConfig.buildFromProjectDir(sourceDir);
    const scene = new Scene();
    scene.buildSceneFromProjectDir(sceneConfig);
    scene.inferTypes();

    const sinkArg0Sig = findMethodSignature(scene, "SinkArg0", "taint_mock");
    const sinkArg1Sig = findMethodSignature(scene, "SinkArg1", "taint_mock");
    const invokeKindHostClassSig = findDeclaringClassSignature(scene, "InvokeKindHost", "SinkInvokeKind");

    const sourceRules: SourceRule[] = [
        {
            id: "source.sink_exact.entry_param.taint_src",
            sourceKind: "entry_param",
            target: "arg0",
            match: { kind: "local_name_regex", value: "^taint_src$" },
        },
    ];

    const sinkRules: SinkRule[] = [
        {
            id: "sink.exact.signature_equals.arg0",
            target: { endpoint: "arg0" },
            match: { kind: "signature_equals", value: sinkArg0Sig },
        },
        {
            id: "sink.exact.callee_signature_equals.arg1",
            target: { endpoint: "arg1" },
            match: { kind: "signature_equals", value: sinkArg1Sig },
        },
        {
            id: "sink.exact.declaring_class_equals.invoke_kind_host",
            target: { endpoint: "arg0" },
            match: {
                kind: "declaring_class_equals",
                value: invokeKindHostClassSig,
                invokeKind: "instance",
                argCount: 1,
            },
        },
    ];

    const validation = validateRuleSet({
        schemaVersion: "2.0",
        sources: sourceRules,
        sinks: sinkRules,
        transfers: [],
    });
    assert(validation.valid, `sink exact-match rules invalid: ${validation.errors.join("; ")}`);

    const cases: CaseSpec[] = [
        { name: "sink_target_arg0_001_T", expected: true },
        { name: "sink_target_arg0_002_F", expected: false },
        { name: "sink_target_arg1_003_T", expected: true },
        { name: "sink_target_arg1_004_F", expected: false },
        { name: "sink_invoke_kind_007_T", expected: true },
        { name: "sink_invoke_kind_008_F", expected: false },
    ];

    let passCount = 0;
    for (const c of cases) {
        const detectedWithRules = await runCase(scene, c.name, sourceRules, sinkRules);
        const detectedWithoutRules = await runCase(scene, c.name, sourceRules, []);
        const pass = c.expected
            ? (detectedWithRules && !detectedWithoutRules)
            : !detectedWithRules;
        if (pass) passCount++;

        console.log(
            `${pass ? "PASS" : "FAIL"} ${c.name} expected=${c.expected ? "T" : "F"} `
            + `withRules=${detectedWithRules} withoutRules=${detectedWithoutRules}`
        );
    }

    console.log("====== Sink Exact Match Test ======");
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


