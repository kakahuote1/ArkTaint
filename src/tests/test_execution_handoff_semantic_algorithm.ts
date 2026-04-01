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
    executionHandoffSemanticAlgorithmKey,
    executionHandoffSemanticAlgorithmScore,
    expectedExecutionHandoffSemanticAlgorithm,
    projectExecutionHandoffSemanticAlgorithm,
    sameExecutionHandoffSemanticAlgorithm,
    type ExecutionHandoffSemanticAlgorithm,
    type ExecutionHandoffSemanticAlgorithmProjection,
} from "./helpers/ExecutionHandoffSemanticAlgorithm";
import type { MainlineDeferredHandoffMode } from "../core/orchestration/ExecutionHandoffModes";

interface CaseSemanticAlgorithmResult {
    caseName: string;
    twinGroup: string;
    semanticFamily: string;
    layer: string;
    variantId: string;
    expected: ExecutionHandoffSemanticAlgorithm;
    observed: ExecutionHandoffSemanticAlgorithmProjection[];
    matched: boolean;
    selected?: ExecutionHandoffSemanticAlgorithmProjection;
    score: number;
}

interface ScopeSemanticAlgorithmSummary {
    scopeName: string;
    totalCases: number;
    deferredCases: number;
    deferredMatches: number;
    controlCases: number;
    controlPass: boolean;
    semanticCollisionCount: number;
    eventShapeInvariant: boolean;
    twinInvariant: boolean;
    results: CaseSemanticAlgorithmResult[];
}

interface SemanticAlgorithmCollision {
    observedSemanticKey: string;
    expectedSemanticKeys: string[];
    cases: string[];
}

interface SemanticAlgorithmReport {
    generatedAt: string;
    manifests: string[];
    totalCases: number;
    deferredCases: number;
    deferredCoverage: number;
    controlCases: number;
    controlPass: boolean;
    semanticCollisionCount: number;
    eventShapeInvariant: boolean;
    twinInvariant: boolean;
    collisions: SemanticAlgorithmCollision[];
    scopeSummaries: Array<{
        scopeName: string;
        totalCases: number;
        deferredCases: number;
        deferredMatches: number;
        controlCases: number;
        controlPass: boolean;
        semanticCollisionCount: number;
        eventShapeInvariant: boolean;
        twinInvariant: boolean;
    }>;
    results: ScopeSemanticAlgorithmSummary[];
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
): Promise<CaseSemanticAlgorithmResult> {
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
    const observed = (snapshot?.contracts || []).map(projectExecutionHandoffSemanticAlgorithm);
    const expected = expectedExecutionHandoffSemanticAlgorithm(spec);

    if (spec.factors.deferred === false) {
        const controlProjection = observed.find(item =>
            item.algorithm.kernel.domain === "control"
            && item.algorithm.kernel.activation === "call(c)",
        );
        return {
            caseName: spec.caseName,
            twinGroup: spec.twinGroup,
            semanticFamily: spec.semanticFamily || spec.twinGroup,
            layer: spec.layer,
            variantId: spec.variantId || spec.caseName,
            expected,
            observed,
            matched: observed.length === 0 || !!controlProjection,
            selected: controlProjection,
            score: observed.length === 0
                ? 1
                : (controlProjection ? executionHandoffSemanticAlgorithmScore(expected, controlProjection.algorithm) : 0),
        };
    }

    const exact = observed.find(item => sameExecutionHandoffSemanticAlgorithm(expected, item.algorithm));
    if (exact) {
        return {
            caseName: spec.caseName,
            twinGroup: spec.twinGroup,
            semanticFamily: spec.semanticFamily || spec.twinGroup,
            layer: spec.layer,
            variantId: spec.variantId || spec.caseName,
            expected,
            observed,
            matched: true,
            selected: exact,
            score: executionHandoffSemanticAlgorithmScore(expected, exact.algorithm),
        };
    }

    let best: ExecutionHandoffSemanticAlgorithmProjection | undefined;
    let bestScore = -1;
    for (const item of observed) {
        const score = executionHandoffSemanticAlgorithmScore(expected, item.algorithm);
        if (score > bestScore) {
            best = item;
            bestScore = score;
        }
    }

    return {
        caseName: spec.caseName,
        twinGroup: spec.twinGroup,
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
    results: CaseSemanticAlgorithmResult[],
): ScopeSemanticAlgorithmSummary {
    const manifest = loadExecutionHandoffCompareManifest(manifestPath);
    const deferredResults = results.filter(item => item.expected.kernel.domain === "deferred");
    const controlResults = results.filter(item => item.expected.kernel.domain === "control");

    const expectedByObserved = new Map<string, { expectedKeys: Set<string>; cases: Set<string> }>();
    for (const result of deferredResults) {
        if (!result.selected) continue;
        const observedKey = executionHandoffSemanticAlgorithmKey(result.selected.algorithm);
        const expectedKey = executionHandoffSemanticAlgorithmKey(result.expected);
        if (!expectedByObserved.has(observedKey)) {
            expectedByObserved.set(observedKey, { expectedKeys: new Set<string>(), cases: new Set<string>() });
        }
        expectedByObserved.get(observedKey)!.expectedKeys.add(expectedKey);
        expectedByObserved.get(observedKey)!.cases.add(result.caseName);
    }

    const eventShapeCases = deferredResults.filter(item => item.semanticFamily === "event_capture_shape");
    const eventShapeKeys = new Set(
        eventShapeCases
            .map(item => item.selected)
            .filter((item): item is ExecutionHandoffSemanticAlgorithmProjection => !!item)
            .map(item => executionHandoffSemanticAlgorithmKey(item.algorithm)),
    );

    const deferredTwinGroups = new Map<string, Set<string>>();
    for (const result of deferredResults) {
        if (!result.selected) continue;
        if (!deferredTwinGroups.has(result.twinGroup)) {
            deferredTwinGroups.set(result.twinGroup, new Set<string>());
        }
        deferredTwinGroups.get(result.twinGroup)!.add(executionHandoffSemanticAlgorithmKey(result.selected.algorithm));
    }

    return {
        scopeName: manifest.activeCompareScope.name,
        totalCases: results.length,
        deferredCases: deferredResults.length,
        deferredMatches: deferredResults.filter(item => item.matched).length,
        controlCases: controlResults.length,
        controlPass: controlResults.every(item => item.matched),
        semanticCollisionCount: [...expectedByObserved.values()].filter(item => item.expectedKeys.size > 1).length,
        eventShapeInvariant: eventShapeCases.length === 0 ? false : eventShapeKeys.size === 1,
        twinInvariant: [...deferredTwinGroups.values()].every(keys => keys.size === 1),
        results,
    };
}

function buildCollisionList(scopes: ScopeSemanticAlgorithmSummary[]): SemanticAlgorithmCollision[] {
    const merged = new Map<string, { expectedKeys: Set<string>; cases: Set<string> }>();
    for (const scope of scopes) {
        for (const result of scope.results) {
            if (result.expected.kernel.domain !== "deferred" || !result.selected) {
                continue;
            }
            const observedKey = executionHandoffSemanticAlgorithmKey(result.selected.algorithm);
            const expectedKey = executionHandoffSemanticAlgorithmKey(result.expected);
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

function renderMarkdown(report: SemanticAlgorithmReport): string {
    const lines: string[] = [];
    lines.push("# Execution Handoff Semantic Algorithm Proof");
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
    lines.push(`- twinInvariant=${report.twinInvariant}`);
    lines.push("");
    lines.push("## Scopes");
    lines.push("");
    for (const scope of report.scopeSummaries) {
        lines.push(
            `- \`${scope.scopeName}\`: deferred=${scope.deferredMatches}/${scope.deferredCases}, `
            + `control=${scope.controlPass}, collisions=${scope.semanticCollisionCount}, `
            + `eventShapeInvariant=${scope.eventShapeInvariant}, twinInvariant=${scope.twinInvariant}`,
        );
    }
    lines.push("");
    return lines.join("\n");
}

async function main(): Promise<void> {
    const outputDir = path.resolve("tmp/test_runs/research/execution_handoff_semantic_algorithm/latest");
    const caseViewRoot = path.join(outputDir, "case_views");
    ensureDir(caseViewRoot);

    const scopeResults: ScopeSemanticAlgorithmSummary[] = [];
    for (const manifestPath of MANIFESTS) {
        const manifest = loadExecutionHandoffCompareManifest(manifestPath);
        const cases = activeExecutionHandoffCompareCases(manifest);
        const results: CaseSemanticAlgorithmResult[] = [];
        for (const spec of cases) {
            results.push(await runCase(manifestPath, spec, caseViewRoot));
        }
        scopeResults.push(summarizeScope(manifestPath, results));
    }

    const allResults = scopeResults.flatMap(scope => scope.results);
    const deferredResults = allResults.filter(item => item.expected.kernel.domain === "deferred");
    const controlResults = allResults.filter(item => item.expected.kernel.domain === "control");
    const collisions = buildCollisionList(scopeResults);

    const report: SemanticAlgorithmReport = {
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
        twinInvariant: scopeResults.every(scope => scope.twinInvariant),
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
            twinInvariant: scope.twinInvariant,
        })),
        results: scopeResults,
    };

    fs.writeFileSync(
        path.join(outputDir, "execution_handoff_semantic_algorithm.json"),
        JSON.stringify(report, null, 2),
        "utf8",
    );
    fs.writeFileSync(
        path.join(outputDir, "execution_handoff_semantic_algorithm.md"),
        renderMarkdown(report),
        "utf8",
    );

    assert(report.deferredCoverage === 1, `semantic algorithm deferred coverage expected 1.000, got ${report.deferredCoverage.toFixed(3)}`);
    assert(report.controlPass, "semantic algorithm should preserve direct-call boundary controls");
    assert(report.semanticCollisionCount === 0, `semantic algorithm should not merge distinct deferred semantics, collisions=${report.semanticCollisionCount}`);
    assert(report.eventShapeInvariant, "semantic algorithm should stay invariant across event handoff shape perturbations");
    assert(report.twinInvariant, "semantic algorithm should remain invariant inside each deferred twin group");

    console.log("execution_handoff_semantic_algorithm=PASS");
    console.log(`totalCases=${report.totalCases}`);
    console.log(`deferredCases=${report.deferredCases}`);
    console.log(`deferredCoverage=${report.deferredCoverage.toFixed(3)}`);
    console.log(`controlCases=${report.controlCases}`);
    console.log(`controlPass=${report.controlPass}`);
    console.log(`semanticCollisionCount=${report.semanticCollisionCount}`);
    console.log(`eventShapeInvariant=${report.eventShapeInvariant}`);
    console.log(`twinInvariant=${report.twinInvariant}`);
}

main().catch(err => {
    console.error("execution_handoff_semantic_algorithm=FAIL");
    console.error(err);
    process.exitCode = 1;
});
