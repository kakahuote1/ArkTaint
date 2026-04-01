import * as fs from "fs";
import * as path from "path";
import { Scene } from "../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../arkanalyzer/out/src/Config";
import { ArkMethod } from "../../arkanalyzer/out/src/core/model/ArkMethod";
import { buildArkMainPlan } from "../core/entry/arkmain/ArkMainPlanner";
import { resolveKnownFrameworkCallbackRegistrationWithPolicy } from "../core/entry/shared/FrameworkCallbackClassifier";
import { resolveMethodsFromCallable } from "../core/substrate/queries/CalleeResolver";
import { registerMockSdkFiles } from "./helpers/TestSceneBuilder";

type CaseKind = "hard_negative" | "positive_control";

interface CaseSpec {
    caseName: string;
    kind: CaseKind;
    description: string;
}

interface CallableSiteProbe {
    sourceMethod: string;
    ownerName: string;
    methodName: string;
    callableArgIndexes: number[];
    structuralRecognized: boolean;
}

interface CaseReport {
    caseName: string;
    kind: CaseKind;
    description: string;
    callableSiteCount: number;
    structuralRecognizedSiteCount: number;
    totalCallbackFactCount: number;
    structuralCallbackFactCount: number;
    structuralCallbackMethods: string[];
    callbackFactLayers: string[];
}

interface BenchmarkReport {
    generatedAt: string;
    sourceDir: string;
    totalCases: number;
    hardNegativeCases: number;
    positiveControlCases: number;
    negativeCasesExercised: number;
    negativeCasesWithStructuralRisk: number;
    positiveControlsPreserved: number;
    reports: CaseReport[];
}

const CASES: CaseSpec[] = [
    {
        caseName: "layer4_sync_hof_sort_001_F",
        kind: "hard_negative",
        description: "sync HOF sort comparator should not become a framework callback entry",
    },
    {
        caseName: "layer4_sync_hof_filter_map_002_F",
        kind: "hard_negative",
        description: "sync HOF filter/map callbacks should not become framework callback entries",
    },
    {
        caseName: "layer4_sync_hof_reduce_foreach_003_F",
        kind: "hard_negative",
        description: "sync HOF reduce/forEach callbacks should not become framework callback entries",
    },
    {
        caseName: "layer4_samefile_sync_helper_004_F",
        kind: "hard_negative",
        description: "same-file synchronous helper callback should not be treated as a framework entry",
    },
    {
        caseName: "layer4_immediate_runner_005_F",
        kind: "hard_negative",
        description: "immediate callback execution should not be treated as async/registered entry",
    },
    {
        caseName: "layer4_internal_constructor_executor_007_F",
        kind: "hard_negative",
        description: "project constructor executor callback should not become a framework callback entry",
    },
    {
        caseName: "layer4_samefile_framework_wrapper_006_T",
        kind: "positive_control",
        description: "same-file wrapper forwarding a handler into Button.onClick must stay discoverable",
    },
];

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

function ensureDir(dir: string): void {
    fs.mkdirSync(dir, { recursive: true });
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

function isSemanticCaseFile(fileName: string): boolean {
    return /\.(ets|ts)$/.test(fileName) && /_(T|F)\./.test(fileName);
}

function createCaseView(sourceDir: string, caseName: string, outputRoot: string): string {
    const caseDir = path.join(outputRoot, caseName);
    fs.rmSync(caseDir, { recursive: true, force: true });
    ensureDir(caseDir);

    for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
        if (!entry.isFile()) continue;
        const fileName = entry.name;
        const isCaseFile = fileName === `${caseName}.ets` || fileName === `${caseName}.ts`;
        if (!isCaseFile && isSemanticCaseFile(fileName)) {
            continue;
        }
        fs.copyFileSync(path.join(sourceDir, fileName), path.join(caseDir, fileName));
    }
    return caseDir;
}

function resolveSeedMethod(scene: Scene, caseName: string): ArkMethod {
    const seedMethod = scene.getMethods().find(method => method.getName?.() === caseName);
    if (!seedMethod) {
        throw new Error(`missing seed method for ${caseName}`);
    }
    return seedMethod;
}

function methodRef(method: ArkMethod): string {
    const className = method.getDeclaringArkClass?.()?.getName?.() || "@global";
    return `${className}.${method.getName()}`;
}

function findCallableArgIndexes(scene: Scene, explicitArgs: any[]): number[] {
    const indexes: number[] = [];
    explicitArgs.forEach((arg, index) => {
        const methods = resolveMethodsFromCallable(scene, arg, CALLBACK_RESOLVE_OPTIONS);
        if (methods.length > 0) {
            indexes.push(index);
        }
    });
    return indexes;
}

function collectCallableSiteProbes(scene: Scene): CallableSiteProbe[] {
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

function analyzeCase(projectDir: string, spec: CaseSpec): CaseReport {
    const scene = buildScene(projectDir);
    const seedMethod = resolveSeedMethod(scene, spec.caseName);
    const probes = collectCallableSiteProbes(scene);
    const plan = buildArkMainPlan(scene, { seedMethods: [seedMethod] });
    const callbackFacts = plan.facts.filter(fact => fact.kind === "callback");
    const structuralCallbackFacts = callbackFacts.filter(fact => fact.callbackRecognitionLayer === "structural_callable_fallback");

    return {
        caseName: spec.caseName,
        kind: spec.kind,
        description: spec.description,
        callableSiteCount: probes.length,
        structuralRecognizedSiteCount: probes.filter(probe => probe.structuralRecognized).length,
        totalCallbackFactCount: callbackFacts.length,
        structuralCallbackFactCount: structuralCallbackFacts.length,
        structuralCallbackMethods: structuralCallbackFacts.map(fact => methodRef(fact.method)).sort((a, b) => a.localeCompare(b)),
        callbackFactLayers: [...new Set(callbackFacts.map(fact => fact.callbackRecognitionLayer || "<none>"))].sort((a, b) => a.localeCompare(b)),
    };
}

function assert(condition: unknown, message: string): void {
    if (!condition) {
        throw new Error(message);
    }
}

async function main(): Promise<void> {
    const sourceDir = path.resolve("tests/demo/layer4_hard_negatives");
    const outputDir = path.resolve("tmp/test_runs/entry_model/layer4_hard_negative_benchmark/latest");
    const caseViewRoot = path.join(outputDir, "case_views");
    ensureDir(outputDir);
    ensureDir(caseViewRoot);

    const reports: CaseReport[] = [];
    for (const spec of CASES) {
        const projectDir = createCaseView(sourceDir, spec.caseName, caseViewRoot);
        reports.push(analyzeCase(projectDir, spec));
    }

    const hardNegativeReports = reports.filter(report => report.kind === "hard_negative");
    const positiveControlReports = reports.filter(report => report.kind === "positive_control");
    const report: BenchmarkReport = {
        generatedAt: new Date().toISOString(),
        sourceDir: sourceDir,
        totalCases: reports.length,
        hardNegativeCases: hardNegativeReports.length,
        positiveControlCases: positiveControlReports.length,
        negativeCasesExercised: hardNegativeReports.filter(report => report.callableSiteCount > 0).length,
        negativeCasesWithStructuralRisk: hardNegativeReports.filter(report => report.structuralCallbackFactCount > 0).length,
        positiveControlsPreserved: positiveControlReports.filter(report => report.totalCallbackFactCount > 0).length,
        reports,
    };

    const reportPath = path.join(outputDir, "layer4_hard_negative_report.json");
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");

    assert(
        report.negativeCasesExercised === report.hardNegativeCases,
        `hard-negative benchmark has unexercised cases: exercised=${report.negativeCasesExercised}/${report.hardNegativeCases}`,
    );
    assert(
        report.negativeCasesWithStructuralRisk === 0,
        `Layer 4 hard-negative risk remains: ${report.negativeCasesWithStructuralRisk}/${report.hardNegativeCases}`,
    );
    assert(
        report.positiveControlsPreserved === report.positiveControlCases,
        `positive control regressed: preserved=${report.positiveControlsPreserved}/${report.positiveControlCases}`,
    );
    assert(
        positiveControlReports.every(reportItem => reportItem.structuralCallbackFactCount === 0),
        "positive control should now be preserved via helper-following / framework matching, not structural fallback",
    );

    console.log("PASS test_entry_model_layer4_hard_negatives");
    console.log(`report=${reportPath}`);
    console.log(`total_cases=${report.totalCases}`);
    console.log(`hard_negative_cases=${report.hardNegativeCases}`);
    console.log(`negative_cases_exercised=${report.negativeCasesExercised}`);
    console.log(`negative_cases_with_structural_risk=${report.negativeCasesWithStructuralRisk}`);
    console.log(`positive_controls_preserved=${report.positiveControlsPreserved}`);
}

main().catch(error => {
    console.error("FAIL test_entry_model_layer4_hard_negatives");
    console.error(error);
    process.exit(1);
});

