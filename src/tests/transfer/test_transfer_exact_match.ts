import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../../arkanalyzer/out/src/Config";
import { PagNode } from "../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import { TaintPropagationEngine } from "../../core/orchestration/TaintPropagationEngine";
import { SinkRule, SourceRule, TransferRule } from "../../core/rules/RuleSchema";
import { validateRuleSet } from "../../core/rules/RuleValidator";
import {
    exactSinkRule,
    exactSourceRule,
    exactTransferRule,
    type ExactRuleRuntime,
} from "../rules/ExactRuleTestUtils";
import {
    assertCanonicalExactRules,
    canonicalApiIdMatch,
    exactTransferRuntimeFromFixtures,
} from "./ExactTransferTestUtils";
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
    sinkRules: SinkRule[],
    transferRules: TransferRule[],
    runtime: ExactRuleRuntime,
): Promise<boolean> {
    const entryMethod = scene.getMethods().find(m => m.getName() === caseName);
    assert(entryMethod, `case method not found: ${caseName}`);
    const engine = new TaintPropagationEngine(scene, 1, {
        ...runtime,
        transferRules,
        includeBuiltinModules: false,
    });
    engine.verbose = false;
    await engine.buildPAG({
        entryModel: "explicit",
        syntheticEntryMethods: [entryMethod],
    });
    engine.setActiveReachableMethodSignatures(undefined, { mergeExplicitEntryScope: false });
    const seedNodes = findSeedNodes(engine, scene, caseName, "taint_src");
    assert(seedNodes.length > 0, `${caseName}: expected taint_src seed nodes`);
    engine.propagateWithSeeds(seedNodes);
    const flows = engine.detectSinksByRules(sinkRules);
    const scopedFlows = flows.filter(flow => flowSinkInCaseMethod(scene, flow.sink, caseName));
    return scopedFlows.length > 0;
}

function findSeedNodes(engine: TaintPropagationEngine, scene: Scene, methodName: string, localName: string): PagNode[] {
    const method = scene.getMethods().find(m => m.getName() === methodName);
    assert(method, `method not found: ${methodName}`);
    const cfg = method.getCfg();
    assert(cfg, `cfg not found: ${methodName}`);
    for (const stmt of cfg.getStmts()) {
        const left = (stmt as any).getLeftOp?.();
        if (!left || left.getName?.() !== localName) continue;
        const nodeIds = engine.pag.getNodesByValue(left);
        return nodeIds ? [...nodeIds.values()].map(id => engine.pag.getNode(id) as PagNode) : [];
    }
    return [];
}

function findMethodForClass(scene: Scene, className: string, methodName: string) {
    const method = scene.getMethods().find(m =>
        m.getName() === methodName
        && m.getDeclaringArkClass?.()?.getName?.() === className
    );
    assert(method, `method not found: ${className}.${methodName}`);
    return method;
}

function findAnyMethod(scene: Scene, methodName: string) {
    const method = scene.getMethods().find(m => m.getName() === methodName);
    assert(method, `method not found: ${methodName}`);
    return method;
}

async function main(): Promise<void> {
    const sourceDir = path.resolve("tests/demo/rule_precision_transfer");
    const sceneConfig = new SceneConfig();
    sceneConfig.buildFromProjectDir(sourceDir);
    const scene = new Scene();
    scene.buildSceneFromProjectDir(sceneConfig);
    scene.inferTypes();

    const invokeKindHostMethod = findMethodForClass(scene, "InvokeKindHost", "BridgeInvokeKind");
    const scopeAllowedMethod = findMethodForClass(scene, "ScopeHostAllowed", "BridgeScope");
    const sinkMethod = scene.getMethods().find(m => m.getName() === "Sink");
    assert(sinkMethod, "sink method not found");
    const sinkEffect = exactSinkRule({
        id: "sink.arg0",
        method: sinkMethod,
        target: { endpoint: "arg0" },
    });
    const transferInvokeEffect = exactTransferRule({
        id: "transfer.canonical.invoke_kind_host",
        method: invokeKindHostMethod,
        from: "arg0",
        to: "result",
    });
    const transferScopeExactEffect = exactTransferRule({
        id: "transfer.canonical.scope_allowed",
        method: scopeAllowedMethod,
        from: "arg0",
        to: "result",
    });
    const transferScopeDuplicateEffect = exactTransferRule({
        id: "transfer.canonical.scope_allowed.duplicate",
        method: scopeAllowedMethod,
        from: "arg0",
        to: "result",
    });
    const cases: CaseSpec[] = [
        { name: "transfer_invoke_kind_003_T", expected: true },
        { name: "transfer_invoke_kind_004_F", expected: false },
        { name: "transfer_scope_009_T", expected: true },
        { name: "transfer_scope_010_F", expected: false },
    ];

    const sourceEffects = cases.map(c => {
        const method = findAnyMethod(scene, c.name);
        return {
            caseName: c.name,
            exact: exactSourceRule({
                id: `source.exact.entry.${c.name}`,
                method,
                target: "arg0",
                sourceKind: "entry_param",
            }),
        };
    });
    const exactRuntime = exactTransferRuntimeFromFixtures([
        sinkEffect,
        transferInvokeEffect,
        transferScopeExactEffect,
        transferScopeDuplicateEffect,
        ...sourceEffects.map(item => item.exact),
    ]);

    const sourceRules: SourceRule[] = sourceEffects.map(({ exact }) => exact.rule);
    const sinkRules: SinkRule[] = [sinkEffect.rule];
    const transferRules: TransferRule[] = [
        transferInvokeEffect.rule,
        transferScopeExactEffect.rule,
        transferScopeDuplicateEffect.rule,
    ];
    assertCanonicalExactRules([...sourceRules, ...sinkRules, ...transferRules]);

    const validation = validateRuleSet({
        sources: sourceRules,
        sinks: sinkRules,
        transfers: transferRules,
    });
    assert(validation.valid, `exact-match rules invalid: ${validation.errors.join("; ")}`);

    const pathFromValidation = validateRuleSet({
        sources: [],
        sinks: [],
        transfers: [{
            id: "transfer.path_from.ok",
            match: canonicalApiIdMatch(transferInvokeEffect.rule),
            apiEffect: transferInvokeEffect.rule.apiEffect,
            from: {
                endpoint: "base",
                pathFrom: "arg0",
                slotKind: "map",
            },
            to: "result",
        }],
    });
    assert(pathFromValidation.valid, `pathFrom transfer rule should be valid: ${pathFromValidation.errors.join("; ")}`);

    const appendSlotValidation = validateRuleSet({
        sources: [],
        sinks: [],
        transfers: [{
            id: "transfer.path_from.append.ok",
            match: canonicalApiIdMatch(transferInvokeEffect.rule),
            apiEffect: transferInvokeEffect.rule.apiEffect,
            from: "arg1",
            to: {
                endpoint: "base",
                pathFrom: "arg0",
                slotKind: "headers",
                slotWriteMode: "append",
            },
        }],
    });
    assert(appendSlotValidation.valid, `append slot transfer rule should be valid: ${appendSlotValidation.errors.join("; ")}`);

    const invalidSlotWriteModeValidation = validateRuleSet({
        sources: [],
        sinks: [],
        transfers: [{
            id: "transfer.path_from.append.invalid.mode",
            match: canonicalApiIdMatch(transferInvokeEffect.rule),
            apiEffect: transferInvokeEffect.rule.apiEffect,
            from: "arg1",
            to: {
                endpoint: "base",
                pathFrom: "arg0",
                slotKind: "headers",
                slotWriteMode: "merge",
            } as any,
        }],
    });
    assert(!invalidSlotWriteModeValidation.valid, "invalid slotWriteMode should be rejected");
    assert(
        invalidSlotWriteModeValidation.errors.some(err => err.includes("slotWriteMode must be replace/append")),
        `invalid slotWriteMode rejection missing, errors=${invalidSlotWriteModeValidation.errors.join("; ")}`
    );

    const orphanSlotWriteModeValidation = validateRuleSet({
        sources: [],
        sinks: [],
        transfers: [{
            id: "transfer.path_from.append.invalid.scope",
            match: canonicalApiIdMatch(transferInvokeEffect.rule),
            apiEffect: transferInvokeEffect.rule.apiEffect,
            from: "arg1",
            to: {
                endpoint: "base",
                slotWriteMode: "append",
            } as any,
        }],
    });
    assert(!orphanSlotWriteModeValidation.valid, "slotWriteMode without pathFrom+slotKind should be rejected");
    assert(
        orphanSlotWriteModeValidation.errors.some(err => err.includes("slotWriteMode requires pathFrom and slotKind")),
        `orphan slotWriteMode rejection missing, errors=${orphanSlotWriteModeValidation.errors.join("; ")}`
    );

    const containedPayloadValidation = validateRuleSet({
        sources: [],
        sinks: [],
        transfers: [{
            id: "transfer.contained_payload.ok",
            match: canonicalApiIdMatch(transferInvokeEffect.rule),
            apiEffect: transferInvokeEffect.rule.apiEffect,
            from: {
                endpoint: "arg1",
                taintScope: "contained-values",
            },
            to: {
                endpoint: "base",
                pathFrom: "arg0",
                slotKind: "sql-table",
            },
        }],
    });
    assert(
        containedPayloadValidation.valid,
        `contained payload transfer rule should be valid: ${containedPayloadValidation.errors.join("; ")}`
    );

    const invalidContainedPayloadValidation = validateRuleSet({
        sources: [],
        sinks: [],
        transfers: [{
            id: "transfer.contained_payload.invalid",
            match: canonicalApiIdMatch(transferInvokeEffect.rule),
            apiEffect: transferInvokeEffect.rule.apiEffect,
            from: {
                endpoint: "arg1",
                taintScope: "deep-object",
            } as any,
            to: "base",
        }],
    });
    assert(!invalidContainedPayloadValidation.valid, "invalid taintScope should be rejected");
    assert(
        invalidContainedPayloadValidation.errors.some(err => err.includes("taintScope must be self/contained-values")),
        `invalid taintScope rejection missing, errors=${invalidContainedPayloadValidation.errors.join("; ")}`
    );

    const sourcePathValidation = validateRuleSet({
        sources: [{
            id: "source.static.path.ok",
            sourceKind: "field_read",
            target: {
                endpoint: "result",
                path: ["secret"],
            },
            match: canonicalApiIdMatch(sourceEffects[0].exact.rule),
            apiEffect: sourceEffects[0].exact.rule.apiEffect,
        }],
        sinks: [],
        transfers: [],
    });
    assert(sourcePathValidation.valid, `source static path rule should be valid: ${sourcePathValidation.errors.join("; ")}`);

    const sinkPathValidation = validateRuleSet({
        sources: [],
        sinks: [{
            id: "sink.static.path.ok",
            target: {
                endpoint: "arg0",
                path: ["secret"],
            },
            match: canonicalApiIdMatch(sinkEffect.rule),
            apiEffect: sinkEffect.rule.apiEffect,
        }],
        transfers: [],
    });
    assert(sinkPathValidation.valid, `sink static path rule should be valid: ${sinkPathValidation.errors.join("; ")}`);

    const transferPathValidation = validateRuleSet({
        sources: [],
        sinks: [],
        transfers: [{
            id: "transfer.static.path.ok",
            match: canonicalApiIdMatch(transferInvokeEffect.rule),
            apiEffect: transferInvokeEffect.rule.apiEffect,
            from: {
                endpoint: "base",
                path: ["payload"],
            },
            to: {
                endpoint: "result",
                path: ["value"],
            },
        }],
    });
    assert(transferPathValidation.valid, `transfer static path rule should be valid: ${transferPathValidation.errors.join("; ")}`);

    const invalidTransferPathValidation = validateRuleSet({
        sources: [],
        sinks: [],
        transfers: [{
            id: "transfer.invalid.path.empty",
            match: canonicalApiIdMatch(transferInvokeEffect.rule),
            apiEffect: transferInvokeEffect.rule.apiEffect,
            from: {
                endpoint: "base",
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                path: [] as any,
            } as any,
            to: "result",
        }],
    });
    assert(!invalidTransferPathValidation.valid, "empty transfer path rule should be rejected");
    assert(
        invalidTransferPathValidation.errors.some(err => err.includes("path must be a non-empty string[]")),
        `empty transfer path rejection missing, errors=${invalidTransferPathValidation.errors.join("; ")}`
    );

    let passCount = 0;
    for (const c of cases) {
        const detectedWithRules = await runCase(scene, c.name, sinkRules, transferRules, exactRuntime);
        const detectedWithoutRules = await runCase(scene, c.name, sinkRules, [], exactRuntime);

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


