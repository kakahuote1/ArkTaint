import * as fs from "fs";
import * as path from "path";
import {
    activeExecutionHandoffCompareCases,
    loadExecutionHandoffCompareManifest,
    type ExecutionHandoffCompareCase,
} from "./helpers/ExecutionHandoffCompareManifest";
import {
    assert,
    createIsolatedCaseView,
    ensureDir,
} from "./helpers/ExecutionHandoffContractSupport";
import {
    buildEngineForCase,
    findCaseMethod,
    resolveCaseMethod,
} from "./helpers/SyntheticCaseHarness";
import { buildInferenceScene } from "./helpers/ExecutionHandoffInferenceSupport";
import {
    executionHandoffSemanticCoreKey,
    executionHandoffSemanticCoreScore,
    expectedExecutionHandoffSemanticCore,
    projectExecutionHandoffSemanticCore,
    sameExecutionHandoffSemanticCore,
    type ExecutionHandoffSemanticCore,
    type ExecutionHandoffSemanticProjection,
} from "./helpers/ExecutionHandoffSemanticCore";
import type { MainlineDeferredHandoffMode } from "../core/orchestration/ExecutionHandoffModes";

interface CaseSemanticCoreResult {
    caseName: string;
    semanticFamily: string;
    layer: string;
    variantId: string;
    expected: ExecutionHandoffSemanticCore;
    observed: ExecutionHandoffSemanticProjection[];
    matched: boolean;
    selected?: ExecutionHandoffSemanticProjection;
    score: number;
}

interface ScopeSemanticCoreSummary {
    scopeName: string;
    totalCases: number;
    deferredCases: number;
    deferredMatches: number;
    controlCases: number;
    controlPass: boolean;
    semanticCollisionCount: number;
    eventShapeInvariant: boolean;
    results: CaseSemanticCoreResult[];
}

interface SemanticCoreCollision {
    observedSemanticKey: string;
    expectedSemanticKeys: string[];
    cases: string[];
}

interface SemanticCoreReport {
    generatedAt: string;
    manifests: string[];
    totalCases: number;
    deferredCases: number;
    deferredCoverage: number;
    controlCases: number;
    controlPass: boolean;
    semanticCollisionCount: number;
    eventShapeInvariant: boolean;
    collisions: SemanticCoreCollision[];
    scopeSummaries: Array<{
        scopeName: string;
        totalCases: number;
        deferredCases: number;
        deferredMatches: number;
        controlCases: number;
        controlPass: boolean;
        semanticCollisionCount: number;
        eventShapeInvariant: boolean;
    }>;
    results: ScopeSemanticCoreSummary[];
}

const MANIFESTS = [
    "tests/adhoc/execution_handoff_compare/compare_manifest.json",
    "tests/adhoc/execution_handoff_compare_async/compare_manifest.json",
    "tests/adhoc/execution_handoff_compare_env/compare_manifest.json",
    "tests/adhoc/execution_handoff_compare_perturbation/compare_manifest.json",
];

async function runCase(
    manifestPath: string,
    spec: ExecutionHandoffCompareCase,
    caseViewRoot: string,
): Promise<CaseSemanticCoreResult> {
    const manifest = loadExecutionHandoffCompareManifest(manifestPath);
    const projectDir = createIsolatedCaseView(path.resolve(manifest.sourceDir), spec.caseName, caseViewRoot);
    const scene = buildInferenceScene(projectDir);
    const entry = resolveCaseMethod(scene, `${spec.caseName}.ets`, spec.caseName);
    const entryMethod = findCaseMethod(scene, entry);
    assert(!!entryMethod, `failed to resolve entry for ${spec.caseName}`);

    const engine = await buildEngineForCase(scene, 1, entryMethod!, {
        verbose: false,
        engineOptions: {
            deferredHandoffMode: "contract_active" as MainlineDeferredHandoffMode,
        },
    });
    const snapshot = engine.getExecutionHandoffContractSnapshot();
    const observed = (snapshot?.contracts || []).map(projectExecutionHandoffSemanticCore);
    const expected = expectedExecutionHandoffSemanticCore(spec);

    if (!spec.factors.deferred) {
        const controlProjection = observed.find(item =>
            item.core.domain === "control"
            && item.core.activation === "call(c)",
        );
        return {
            caseName: spec.caseName,
            semanticFamily: spec.semanticFamily || spec.twinGroup,
            layer: spec.layer,
            variantId: spec.variantId || spec.caseName,
            expected,
            observed,
            matched: observed.length === 0 || !!controlProjection,
            selected: controlProjection,
            score: observed.length === 0
                ? 1
                : (controlProjection ? executionHandoffSemanticCoreScore(expected, controlProjection.core) : 0),
        };
    }

    const exact = observed.find(item => sameExecutionHandoffSemanticCore(expected, item.core));
    if (exact) {
        return {
            caseName: spec.caseName,
            semanticFamily: spec.semanticFamily || spec.twinGroup,
            layer: spec.layer,
            variantId: spec.variantId || spec.caseName,
            expected,
            observed,
            matched: true,
            selected: exact,
            score: executionHandoffSemanticCoreScore(expected, exact.core),
        };
    }

    let best: ExecutionHandoffSemanticProjection | undefined;
    let bestScore = -1;
    for (const item of observed) {
        const score = executionHandoffSemanticCoreScore(expected, item.core);
        if (score > bestScore) {
            best = item;
            bestScore = score;
        }
    }

    return {
        caseName: spec.caseName,
        semanticFamily: spec.semanticFamily || spec.twinGroup,
        layer: spec.layer,
        variantId: spec.variantId || spec.caseName,
        expected,
        observed,
        matched: false,
        selected: best,
        score: Math.max(bestScore, 0),
    };
}

function summarizeScope(
    manifestPath: string,
    results: CaseSemanticCoreResult[],
): ScopeSemanticCoreSummary {
    const manifest = loadExecutionHandoffCompareManifest(manifestPath);
    const deferredResults = results.filter(item => item.expected.domain === "deferred");
    const controlResults = results.filter(item => item.expected.domain === "control");

    const expectedByObserved = new Map<string, { expectedKeys: Set<string>; cases: Set<string> }>();
    for (const result of deferredResults) {
        if (!result.selected) continue;
        const observedKey = executionHandoffSemanticCoreKey(result.selected.core);
        const expectedKey = executionHandoffSemanticCoreKey(result.expected);
        if (!expectedByObserved.has(observedKey)) {
            expectedByObserved.set(observedKey, { expectedKeys: new Set<string>(), cases: new Set<string>() });
        }
        expectedByObserved.get(observedKey)!.expectedKeys.add(expectedKey);
        expectedByObserved.get(observedKey)!.cases.add(result.caseName);
    }

    const eventShapeCases = deferredResults.filter(item => item.semanticFamily === "event_capture_shape");
    const shapeKeys = new Set(
        eventShapeCases
            .map(item => item.selected)
            .filter((item): item is ExecutionHandoffSemanticProjection => !!item)
            .map(item => executionHandoffSemanticCoreKey(item.core)),
    );

    return {
        scopeName: manifest.activeCompareScope.name,
        totalCases: results.length,
        deferredCases: deferredResults.length,
        deferredMatches: deferredResults.filter(item => item.matched).length,
        controlCases: controlResults.length,
        controlPass: controlResults.every(item => item.matched),
        semanticCollisionCount: [...expectedByObserved.values()].filter(item => item.expectedKeys.size > 1).length,
        eventShapeInvariant: eventShapeCases.length === 0 ? false : shapeKeys.size === 1,
        results,
    };
}

function buildCollisionList(scopes: ScopeSemanticCoreSummary[]): SemanticCoreCollision[] {
    const merged = new Map<string, { expectedKeys: Set<string>; cases: Set<string> }>();
    for (const scope of scopes) {
        for (const result of scope.results) {
            if (result.expected.domain !== "deferred" || !result.selected) {
                continue;
            }
            const observedKey = executionHandoffSemanticCoreKey(result.selected.core);
            const expectedKey = executionHandoffSemanticCoreKey(result.expected);
            if (!merged.has(observedKey)) {
                merged.set(observedKey, { expectedKeys: new Set<string>(), cases: new Set<string>() });
            }
            merged.get(observedKey)!.expectedKeys.add(expectedKey);
            merged.get(observedKey)!.cases.add(result.caseName);
        }
    }
    return [...merged.entries()]
        .filter(([, item]) => item.expectedKeys.size > 1)
        .map(([observedSemanticKey, item]) => ({
            observedSemanticKey,
            expectedSemanticKeys: [...item.expectedKeys].sort((a, b) => a.localeCompare(b)),
            cases: [...item.cases].sort((a, b) => a.localeCompare(b)),
        }))
        .sort((a, b) => a.observedSemanticKey.localeCompare(b.observedSemanticKey));
}

function renderMarkdown(report: SemanticCoreReport): string {
    const lines: string[] = [];
    lines.push("# Execution Handoff Semantic Core Proof");
    lines.push("");
    lines.push("## Summary");
    lines.push("");
    lines.push(`- totalCases=${report.totalCases}`);
    lines.push(`- deferredCases=${report.deferredCases}`);
    lines.push(`- deferredCoverage=${report.deferredCoverage.toFixed(3)}`);
    lines.push(`- controlCases=${report.controlCases}`);
    lines.push(`- controlPass=${report.controlPass}`);
    lines.push(`- semanticCollisionCount=${report.semanticCollisionCount}`);
    lines.push(`- eventShapeInvariant=${report.eventShapeInvariant}`);
    lines.push("");
    lines.push("## Scopes");
    lines.push("");
    for (const scope of report.scopeSummaries) {
        lines.push(
            `- \`${scope.scopeName}\`: deferred=${scope.deferredMatches}/${scope.deferredCases}, `
            + `control=${scope.controlPass}, collisions=${scope.semanticCollisionCount}, `
            + `eventShapeInvariant=${scope.eventShapeInvariant}`,
        );
    }
    lines.push("");
    return lines.join("\n");
}

async function main(): Promise<void> {
    const outputDir = path.resolve("tmp/test_runs/research/execution_handoff_semantic_core/latest");
    const caseViewRoot = path.join(outputDir, "case_views");
    ensureDir(caseViewRoot);

    const scopeResults: ScopeSemanticCoreSummary[] = [];
    for (const manifestPath of MANIFESTS) {
        const manifest = loadExecutionHandoffCompareManifest(manifestPath);
        const cases = activeExecutionHandoffCompareCases(manifest);
        const results: CaseSemanticCoreResult[] = [];
        for (const spec of cases) {
            results.push(await runCase(manifestPath, spec, caseViewRoot));
        }
        scopeResults.push(summarizeScope(manifestPath, results));
    }

    const allResults = scopeResults.flatMap(scope => scope.results);
    const deferredResults = allResults.filter(item => item.expected.domain === "deferred");
    const controlResults = allResults.filter(item => item.expected.domain === "control");
    const collisions = buildCollisionList(scopeResults);

    const report: SemanticCoreReport = {
        generatedAt: new Date().toISOString(),
        manifests: MANIFESTS.map(item => path.resolve(item)),
        totalCases: allResults.length,
        deferredCases: deferredResults.length,
        deferredCoverage: deferredResults.length === 0 ? 0 : deferredResults.filter(item => item.matched).length / deferredResults.length,
        controlCases: controlResults.length,
        controlPass: controlResults.every(item => item.matched),
        semanticCollisionCount: collisions.length,
        eventShapeInvariant: scopeResults
            .filter(scope => scope.scopeName === "event_handoff_shape_invariance")
            .every(scope => scope.eventShapeInvariant),
        collisions,
        scopeSummaries: scopeResults.map(scope => ({
            scopeName: scope.scopeName,
            totalCases: scope.totalCases,
            deferredCases: scope.deferredCases,
            deferredMatches: scope.deferredMatches,
            controlCases: scope.controlCases,
            controlPass: scope.controlPass,
            semanticCollisionCount: scope.semanticCollisionCount,
            eventShapeInvariant: scope.eventShapeInvariant,
        })),
        results: scopeResults,
    };

    fs.writeFileSync(
        path.join(outputDir, "execution_handoff_semantic_core.json"),
        JSON.stringify(report, null, 2),
        "utf8",
    );
    fs.writeFileSync(
        path.join(outputDir, "execution_handoff_semantic_core.md"),
        renderMarkdown(report),
        "utf8",
    );

    assert(report.deferredCoverage === 1, `semantic core deferred coverage expected 1.000, got ${report.deferredCoverage.toFixed(3)}`);
    assert(report.controlPass, "semantic core should preserve direct-call boundary controls");
    assert(report.semanticCollisionCount === 0, `semantic core should not merge distinct deferred semantics, collisions=${report.semanticCollisionCount}`);
    assert(report.eventShapeInvariant, "semantic core should stay invariant across event handoff shape perturbations");

    console.log("execution_handoff_semantic_core=PASS");
    console.log(`totalCases=${report.totalCases}`);
    console.log(`deferredCases=${report.deferredCases}`);
    console.log(`deferredCoverage=${report.deferredCoverage.toFixed(3)}`);
    console.log(`controlCases=${report.controlCases}`);
    console.log(`controlPass=${report.controlPass}`);
    console.log(`semanticCollisionCount=${report.semanticCollisionCount}`);
    console.log(`eventShapeInvariant=${report.eventShapeInvariant}`);
}

main().catch(err => {
    console.error("execution_handoff_semantic_core=FAIL");
    console.error(err);
    process.exitCode = 1;
});
