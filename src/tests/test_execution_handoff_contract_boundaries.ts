import * as fs from "fs";
import * as path from "path";
import { Scene } from "../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../arkanalyzer/out/src/Config";
import { ArkMethod } from "../../arkanalyzer/out/src/core/model/ArkMethod";
import { resolveKnownFrameworkCallbackRegistrationWithPolicy } from "../core/entry/shared/FrameworkCallbackClassifier";
import { resolveMethodsFromCallable } from "../core/substrate/queries/CalleeResolver";
import { registerMockSdkFiles } from "./helpers/TestSceneBuilder";
import {
    assert,
    captureBindings,
    createIsolatedCaseView,
    ensureDir,
    findMethod,
    payloadBindings,
    stmtTexts,
} from "./helpers/ExecutionHandoffContractSupport";

type SceneLike = Scene;
type MethodLike = ArkMethod;

interface CallableSiteProbe {
    sourceMethod: string;
    ownerName: string;
    methodName: string;
    callableArgIndexes: number[];
    structuralRecognized: boolean;
}

interface BoundaryCaseReport {
    caseName: string;
    expectedKind: "direct_only";
    callableSiteCount: number;
    structuralRecognizedSiteCount: number;
    recognizedOwners: string[];
    recognizedMethods: string[];
}

const CALLBACK_RESOLVE_OPTIONS = {
    maxCandidates: 8,
    enableLocalBacktrace: true,
    maxBacktraceSteps: 5,
    maxVisitedDefs: 16,
};

const STRUCTURAL_ONLY_POLICY = {
    enableSdkProvenance: false,
    enableOwnerQualifiedFallback: false,
    enableEmptyOwnerFallback: false,
    enableStructuralCallableFallback: true,
    suppressCatalogSlotFamilyInference: true,
} as const;

const CASES = [
    { caseName: "layer4_sync_hof_sort_001_F", expectedKind: "direct_only" as const },
    { caseName: "layer4_sync_hof_filter_map_002_F", expectedKind: "direct_only" as const },
    { caseName: "layer4_samefile_sync_helper_004_F", expectedKind: "direct_only" as const },
    { caseName: "layer4_immediate_runner_005_F", expectedKind: "direct_only" as const },
    { caseName: "layer4_internal_constructor_executor_007_F", expectedKind: "direct_only" as const },
];

function methodRef(method: MethodLike): string {
    const className = method.getDeclaringArkClass?.()?.getName?.() || "@global";
    return `${className}.${method.getName()}`;
}

function buildScene(projectDir: string): Scene {
    const config = new SceneConfig();
    config.buildFromProjectDir(projectDir);
    const scene = new Scene();
    scene.buildSceneFromProjectDir(config);
    scene.inferTypes();
    registerMockSdkFiles(scene);
    return scene;
}

function resolveSeedMethod(scene: SceneLike, caseName: string): MethodLike {
    const seedMethod = scene.getMethods().find((method: MethodLike) => method.getName?.() === caseName);
    assert(!!seedMethod, `missing seed method for ${caseName}`);
    return seedMethod;
}

function findCallableArgIndexes(scene: SceneLike, explicitArgs: any[]): number[] {
    const indexes: number[] = [];
    explicitArgs.forEach((arg, index) => {
        const methods = resolveMethodsFromCallable(scene, arg, CALLBACK_RESOLVE_OPTIONS);
        if (methods.length > 0) {
            indexes.push(index);
        }
    });
    return indexes;
}

function collectCallableSiteProbes(scene: SceneLike): CallableSiteProbe[] {
    const probes: CallableSiteProbe[] = [];
    for (const method of scene.getMethods()) {
        const cfg = method.getCfg?.();
        if (!cfg) continue;
        for (const stmt of cfg.getStmts()) {
            const invokeExpr = stmt?.getInvokeExpr?.();
            if (!invokeExpr) continue;
            const explicitArgs = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
            const callableArgIndexes = findCallableArgIndexes(scene, explicitArgs);
            if (callableArgIndexes.length === 0) continue;
            const methodSig = invokeExpr.getMethodSignature?.();
            const match = resolveKnownFrameworkCallbackRegistrationWithPolicy(
                { invokeExpr, explicitArgs, scene, sourceMethod: method },
                STRUCTURAL_ONLY_POLICY,
            );
            probes.push({
                sourceMethod: methodRef(method),
                ownerName: methodSig?.getDeclaringClassSignature?.()?.getClassName?.() || "",
                methodName: methodSig?.getMethodSubSignature?.()?.getMethodName?.() || "",
                callableArgIndexes,
                structuralRecognized: !!match,
            });
        }
    }
    return probes;
}

function analyzeBoundaryCase(projectDir: string, caseName: string, expectedKind: BoundaryCaseReport["expectedKind"]): BoundaryCaseReport {
    const scene = buildScene(projectDir);
    const probes = collectCallableSiteProbes(scene);
    resolveSeedMethod(scene, caseName);
    const recognized = probes.filter(probe => probe.structuralRecognized);

    return {
        caseName,
        expectedKind,
        callableSiteCount: probes.length,
        structuralRecognizedSiteCount: recognized.length,
        recognizedOwners: [...new Set(recognized.map(probe => probe.ownerName).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
        recognizedMethods: [...new Set(recognized.map(probe => probe.methodName).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    };
}

function assertBoundaryReports(reports: BoundaryCaseReport[]): void {
    for (const report of reports) {
        assert(report.callableSiteCount > 0, `${report.caseName} should contain at least one callable site`);
        assert(
            report.structuralRecognizedSiteCount === 0,
            `${report.caseName} should not instantiate framework/event handoff contracts`,
        );
    }
}

function assertDirectPositiveEventControl(): { callableSiteCount: number; structuralRecognizedSiteCount: number; recognizedMethods: string[] } {
    const scene = buildScene(path.resolve("tests/demo/harmony_callback_registration"));
    const probes = collectCallableSiteProbes(scene).filter(probe => probe.sourceMethod.includes("CallbackPage001.build"));
    const recognized = probes.filter(probe => probe.structuralRecognized);

    assert(probes.length > 0, "direct onClick positive control should contain callable sites");
    assert(recognized.length > 0, "direct onClick positive control should instantiate an event handoff contract");

    const recognizedMethods = [...new Set(recognized.map(probe => probe.methodName).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    assert(recognizedMethods.includes("onClick"), "direct onClick positive control should recognize onClick as the event handoff carrier");

    return {
        callableSiteCount: probes.length,
        structuralRecognizedSiteCount: recognized.length,
        recognizedMethods,
    };
}

function assertFinallyAndAwaitBoundaries(): { finallyPayloadPorts: number; finallyCapturePorts: number; awaitFutureUnits: number } {
    const asyncScene = buildScene(path.resolve("tests/adhoc/ordinary_async_language"));
    const finallyOuter = findMethod(asyncScene, "%dflt.promise_finally_passthrough_011_T(string)");
    const finallyUnit = findMethod(asyncScene, "%dflt.%AM0$promise_finally_passthrough_011_T()");
    const awaitOuter = findMethod(asyncScene, "%dflt.await_catch_chain_013_T(string)");

    const finallyPayloadPorts = payloadBindings(finallyUnit).length;
    const finallyCapturePorts = captureBindings(finallyUnit).length;
    assert(finallyPayloadPorts === 0, "finally callback should expose no payload ports");
    assert(finallyCapturePorts === 0, "this finally sample should expose no capture ports");
    assert(
        stmtTexts(finallyOuter).some(text => text.includes("result = await %1")),
        "finally sample should resume through an await site in the outer method",
    );

    const awaitFutureUnits = asyncScene
        .getMethods()
        .filter((method: MethodLike) => {
            const sig = method.getSignature?.().toString?.() || "";
            return sig.includes("@ordinary_async_language/await_catch_chain_013_T.ets")
                && sig.includes("%AM");
        }).length;
    assert(awaitFutureUnits === 1, "await sample should not introduce an extra future unit beyond the catch continuation");
    assert(
        stmtTexts(awaitOuter).some(text => text.includes("result = await %1")),
        "await sample should contain an explicit await resume site",
    );

    return { finallyPayloadPorts, finallyCapturePorts, awaitFutureUnits };
}

function main(): void {
    const sourceDir = path.resolve("tests/demo/layer4_hard_negatives");
    const outputDir = path.resolve("tmp/test_runs/research/execution_handoff_contract/latest");
    const caseViewRoot = path.join(outputDir, "boundary_case_views");
    ensureDir(outputDir);
    ensureDir(caseViewRoot);

    const reports = CASES.map(spec => {
        const projectDir = createIsolatedCaseView(sourceDir, spec.caseName, caseViewRoot);
        return analyzeBoundaryCase(projectDir, spec.caseName, spec.expectedKind);
    });

    assertBoundaryReports(reports);
    const positiveControl = assertDirectPositiveEventControl();
    const asyncBoundary = assertFinallyAndAwaitBoundaries();

    fs.writeFileSync(
        path.join(outputDir, "execution_handoff_contract_boundaries.json"),
        JSON.stringify(
            {
                generatedAt: new Date().toISOString(),
                reports,
                positiveControl,
                asyncBoundary,
            },
            null,
            2,
        ),
        "utf8",
    );

    console.log("execution_handoff_contract_boundaries=PASS");
    console.log(`cases=${reports.length}`);
}

try {
    main();
} catch (err) {
    console.error("execution_handoff_contract_boundaries=FAIL");
    console.error(err);
    process.exitCode = 1;
}
