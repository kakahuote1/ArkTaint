import { Scene } from "../../../arkanalyzer/lib/Scene";
import { SceneConfig } from "../../../arkanalyzer/lib/Config";
import { TaintPropagationEngine } from "../../core/orchestration/TaintPropagationEngine";
import { SinkRule, SourceRule, TransferRule } from "../../core/rules/RuleSchema";
import { validateRuleSet } from "../../core/rules/RuleValidator";
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
    sinkRules: SinkRule[],
    transferRules: TransferRule[]
): Promise<boolean> {
    const engine = new TaintPropagationEngine(scene, 1, { transferRules });
    engine.verbose = false;
    await engine.buildPAG();
    engine.propagateWithSourceRules(sourceRules);
    const flows = engine.detectSinksByRules(sinkRules);
    const scopedFlows = flows.filter(flow => flowSinkInCaseMethod(scene, flow.sink, caseName));
    return scopedFlows.length > 0;
}

function findMethodSignature(scene: Scene, methodName: string, fileHint: string): string {
    const method = scene.getMethods().find(m => {
        if (m.getName() !== methodName) return false;
        const sig = m.getSignature?.().toString?.() || "";
        return sig.includes(fileHint);
    });
    assert(method, `method not found: ${methodName} in ${fileHint}`);
    return method.getSignature().toString();
}

async function main(): Promise<void> {
    const sourceDir = path.resolve("tests/demo/rule_precision_transfer_ptr");
    const sceneConfig = new SceneConfig();
    sceneConfig.buildFromProjectDir(sourceDir);
    const scene = new Scene();
    scene.buildSceneFromProjectDir(sceneConfig);
    scene.inferTypes();

    const bridgePtrSig = findMethodSignature(scene, "BridgePtr", "/taint_mock.ts");
    const sourceRules: SourceRule[] = [
        {
            id: "source.ptr.entry.taint_src",
            sourceKind: "entry_param",
            target: "arg0",
            match: { kind: "local_name_regex", value: "^taint_src$" },
        },
    ];
    const sinkRules: SinkRule[] = [
        {
            id: "sink.ptr.arg0",
            target: { endpoint: "arg0" },
            match: { kind: "method_name_equals", value: "Sink" },
        },
    ];
    const transferRules: TransferRule[] = [
        {
            id: "transfer.ptr.signature_equals.bridge",
            match: { kind: "signature_equals", value: bridgePtrSig },
            from: "arg0",
            to: "result",
        },
    ];

    const validation = validateRuleSet({
        schemaVersion: "2.0",
        sources: sourceRules,
        sinks: sinkRules,
        transfers: transferRules,
    });
    assert(validation.valid, `ptr transfer rules invalid: ${validation.errors.join("; ")}`);

    const cases: CaseSpec[] = [
        { name: "transfer_ptr_signature_001_T", expected: true },
        { name: "transfer_ptr_signature_002_F", expected: false },
    ];

    let passCount = 0;
    for (const c of cases) {
        const detectedWithRules = await runCase(scene, c.name, sourceRules, sinkRules, transferRules);
        const detectedWithoutRules = await runCase(scene, c.name, sourceRules, sinkRules, []);
        const pass = c.expected
            ? (detectedWithRules && !detectedWithoutRules)
            : !detectedWithRules;
        if (pass) passCount++;

        console.log(
            `${pass ? "PASS" : "FAIL"} ${c.name} expected=${c.expected ? "T" : "F"} `
            + `withRules=${detectedWithRules} withoutRules=${detectedWithoutRules}`
        );
    }

    console.log("====== Transfer Ptr Callee Resolution Test ======");
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


