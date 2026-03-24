import { Scene } from "../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../arkanalyzer/out/src/Config";
import { TaintPropagationEngine } from "../core/orchestration/TaintPropagationEngine";
import { SinkRule, SourceRule, TransferRule } from "../core/rules/RuleSchema";
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

function findMethodSignature(scene: Scene, className: string, methodName: string): string {
    const method = scene.getMethods().find(m =>
        m.getName() === methodName
        && m.getDeclaringArkClass?.()?.getName?.() === className
    );
    assert(method, `method not found: ${className}.${methodName}`);
    return method.getSignature().toString();
}

function findDeclaringClassSignature(scene: Scene, className: string, methodName: string): string {
    const method = scene.getMethods().find(m =>
        m.getName() === methodName
        && m.getDeclaringArkClass?.()?.getName?.() === className
    );
    assert(method, `class signature method not found: ${className}.${methodName}`);
    const classSignature = method.getDeclaringArkClass()?.getSignature?.()?.toString?.();
    assert(classSignature && classSignature.length > 0, `class signature missing for ${className}.${methodName}`);
    return classSignature;
}

async function main(): Promise<void> {
    const sourceDir = path.resolve("tests/demo/rule_precision_transfer");
    const sceneConfig = new SceneConfig();
    sceneConfig.buildFromProjectDir(sourceDir);
    const scene = new Scene();
    scene.buildSceneFromProjectDir(sceneConfig);
    scene.inferTypes();

    const invokeKindHostSig = findMethodSignature(scene, "InvokeKindHost", "BridgeInvokeKind");
    const scopeAllowedSig = findMethodSignature(scene, "ScopeHostAllowed", "BridgeScope");
    const scopeAllowedClassSig = findDeclaringClassSignature(scene, "ScopeHostAllowed", "BridgeScope");

    const sourceRules: SourceRule[] = [
        {
            id: "source.exact.entry.taint_src",
            sourceKind: "entry_param",
            target: "arg0",
            match: { kind: "local_name_regex", value: "^taint_src$" },
        },
    ];

    const sinkRules: SinkRule[] = [
        {
            id: "sink.exact.arg0",
            target: { endpoint: "arg0" },
            match: { kind: "method_name_equals", value: "Sink" },
        },
    ];

    const transferRules: TransferRule[] = [
        {
            id: "transfer.exact.signature_equals.invoke_kind_host",
            match: { kind: "signature_equals", value: invokeKindHostSig },
            from: "arg0",
            to: "result",
        },
        {
            id: "transfer.exact.callee_signature_equals.scope_allowed",
            match: { kind: "signature_equals", value: scopeAllowedSig },
            from: "arg0",
            to: "result",
        },
        {
            id: "transfer.exact.declaring_class_equals.scope_allowed",
            match: { kind: "declaring_class_equals", value: scopeAllowedClassSig },
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
    assert(validation.valid, `exact-match rules invalid: ${validation.errors.join("; ")}`);

    const pathFromValidation = validateRuleSet({
        schemaVersion: "2.0",
        sources: [],
        sinks: [],
        transfers: [{
            id: "transfer.path_from.ok",
            match: { kind: "signature_contains", value: "Map.get", invokeKind: "instance", argCount: 1 },
            from: {
                endpoint: "base",
                pathFrom: "arg0",
                slotKind: "map",
            },
            to: "result",
        }],
    });
    assert(pathFromValidation.valid, `pathFrom transfer rule should be valid: ${pathFromValidation.errors.join("; ")}`);

    const sourcePathValidation = validateRuleSet({
        schemaVersion: "2.0",
        sources: [{
            id: "source.static.path.ok",
            sourceKind: "field_read",
            target: {
                endpoint: "result",
                path: ["secret"],
            },
            match: { kind: "method_name_equals", value: "ReadSecret" },
        }],
        sinks: [],
        transfers: [],
    });
    assert(sourcePathValidation.valid, `source static path rule should be valid: ${sourcePathValidation.errors.join("; ")}`);

    const sinkPathValidation = validateRuleSet({
        schemaVersion: "2.0",
        sources: [],
        sinks: [{
            id: "sink.static.path.ok",
            target: {
                endpoint: "arg0",
                path: ["secret"],
            },
            match: { kind: "method_name_equals", value: "SinkField" },
        }],
        transfers: [],
    });
    assert(sinkPathValidation.valid, `sink static path rule should be valid: ${sinkPathValidation.errors.join("; ")}`);

    const invalidTransferPathValidation = validateRuleSet({
        schemaVersion: "2.0",
        sources: [],
        sinks: [],
        transfers: [{
            id: "transfer.invalid.path.bad",
            match: { kind: "signature_contains", value: "Map.get" },
            from: {
                endpoint: "base",
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                path: ["legacy"] as any,
            } as any,
            to: "result",
        }],
    });
    assert(!invalidTransferPathValidation.valid, "invalid transfer path rule should be rejected");
    assert(
        invalidTransferPathValidation.errors.some(err => err.includes("path is not supported for transfer rules")),
        `invalid transfer path rejection missing, errors=${invalidTransferPathValidation.errors.join("; ")}`
    );

    const cases: CaseSpec[] = [
        { name: "transfer_invoke_kind_003_T", expected: true },
        { name: "transfer_invoke_kind_004_F", expected: false },
        { name: "transfer_scope_009_T", expected: true },
        { name: "transfer_scope_010_F", expected: false },
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

    console.log("====== Transfer Exact Match Test ======");
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


