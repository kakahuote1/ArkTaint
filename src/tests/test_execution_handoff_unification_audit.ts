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
import type {
    ExecutionHandoffContractSnapshotItem,
    HandoffTriggerToken,
    HandoffResumeKind,
} from "../core/kernel/handoff/ExecutionHandoffContract";
import type { MainlineDeferredHandoffMode } from "../core/orchestration/ExecutionHandoffModes";

type CarrierPathClass = "epsilon" | "pass*" | "return" | "load" | "store" | "mixed";
type PayloadClass = "payload0" | "payload+";
type CaptureClass = "capture0" | "capture+";
type PreserveClass = "preserve0" | "settle(rejected)" | "settle(fulfilled)" | "settle(any)" | "mixed";

interface ExpectedTriad {
    carrierPathClass: CarrierPathClass;
    activationToken: HandoffTriggerToken;
    payloadClass: PayloadClass;
    captureClass: CaptureClass;
    resumeKind: HandoffResumeKind;
    preserveClass: PreserveClass;
    deferred: boolean;
}

interface ObservedTriad extends ExpectedTriad {
    contractId: string;
    carrierKind: string;
    pathLabels: string[];
}

interface CaseAuditResult {
    caseName: string;
    semanticFamily: string;
    layer: string;
    variantId: string;
    expectedTriad: ExpectedTriad;
    observedTriads: ObservedTriad[];
    selectedTriad?: ObservedTriad;
    exactCoreMatch: boolean;
    exactExtendedMatch: boolean;
    bestScore: number;
}

interface ScopeAuditResult {
    manifestPath: string;
    scopeName: string;
    totalCases: number;
    exactCoreMatches: number;
    exactExtendedMatches: number;
    semanticCollisionCount: number;
    deferredControlSeparationPass: boolean;
    eventShapeSemanticInvariant: boolean;
    eventShapeCarrierCollapsePass: boolean;
    results: CaseAuditResult[];
}

interface SemanticCollision {
    observedSemanticKey: string;
    expectedSemanticKeys: string[];
    cases: string[];
}

interface UnificationAuditReport {
    generatedAt: string;
    manifests: string[];
    totalCases: number;
    exactCoreCoverage: number;
    exactExtendedCoverage: number;
    semanticCollisionCount: number;
    deferredControlSeparationPass: boolean;
    eventShapeSemanticInvariant: boolean;
    eventShapeCarrierCollapsePass: boolean;
    collisions: SemanticCollision[];
    scopeSummaries: Array<{
        scopeName: string;
        totalCases: number;
        exactCoreMatches: number;
        exactExtendedMatches: number;
        semanticCollisionCount: number;
        deferredControlSeparationPass: boolean;
        eventShapeSemanticInvariant: boolean;
        eventShapeCarrierCollapsePass: boolean;
    }>;
    results: ScopeAuditResult[];
}

const MANIFESTS = [
    "tests/adhoc/execution_handoff_compare/compare_manifest.json",
    "tests/adhoc/execution_handoff_compare_async/compare_manifest.json",
    "tests/adhoc/execution_handoff_compare_perturbation/compare_manifest.json",
];

function expectedActivationToken(spec: ExecutionHandoffCompareCase): HandoffTriggerToken {
    switch (spec.factors.trigger) {
        case "event":
            return "event(c)";
        case "settle_fulfilled":
            return "settle(fulfilled)";
        case "settle_rejected":
            return "settle(rejected)";
        case "settle_any":
            return "settle(any)";
        case "call":
        default:
            return "call(c)";
    }
}

function expectedCarrierPathClass(spec: ExecutionHandoffCompareCase): CarrierPathClass {
    if ((spec.factors.relayDepth || 0) > 0) {
        return "pass*";
    }
    switch (spec.factors.carrier) {
        case "returned_callable":
            return "return";
        case "field_callable":
        case "slot_callable":
            return "load";
        case "direct_callable":
        default:
            return "epsilon";
    }
}

function expectedPayloadClass(spec: ExecutionHandoffCompareCase): PayloadClass {
    return spec.factors.payload === "none" ? "payload0" : "payload+";
}

function expectedCaptureClass(spec: ExecutionHandoffCompareCase): CaptureClass {
    return spec.factors.capture === "none" ? "capture0" : "capture+";
}

function expectedPreserveClass(spec: ExecutionHandoffCompareCase): PreserveClass {
    switch (spec.factors.trigger) {
        case "settle_fulfilled":
            return "settle(rejected)";
        case "settle_rejected":
            return "settle(fulfilled)";
        case "settle_any":
            return "settle(any)";
        default:
            return "preserve0";
    }
}

function buildExpectedTriad(spec: ExecutionHandoffCompareCase): ExpectedTriad {
    return {
        carrierPathClass: expectedCarrierPathClass(spec),
        activationToken: expectedActivationToken(spec),
        payloadClass: expectedPayloadClass(spec),
        captureClass: expectedCaptureClass(spec),
        resumeKind: spec.factors.resume as HandoffResumeKind,
        preserveClass: expectedPreserveClass(spec),
        deferred: spec.factors.deferred,
    };
}

function normalizeCarrierPathClass(pathLabels: string[]): CarrierPathClass {
    const carrierLabels = pathLabels.filter(label =>
        label === "pass" || label === "return" || label === "store" || label === "load",
    );
    const unique = [...new Set(carrierLabels)];
    if (unique.length === 0) {
        return "epsilon";
    }
    if (unique.length > 1) {
        return "mixed";
    }
    switch (unique[0]) {
        case "pass":
            return "pass*";
        case "return":
            return "return";
        case "load":
            return "load";
        case "store":
            return "store";
        default:
            return "mixed";
    }
}

function normalizePayloadClass(item: ExecutionHandoffContractSnapshotItem): PayloadClass {
    return item.ports.payload === "payload+" ? "payload+" : "payload0";
}

function normalizeCaptureClass(item: ExecutionHandoffContractSnapshotItem): CaptureClass {
    return item.ports.env === "envIn" || item.ports.env === "envIO" ? "capture+" : "capture0";
}

function normalizePreserveClass(item: ExecutionHandoffContractSnapshotItem): PreserveClass {
    return item.ports.preserve;
}

function mapObservedTriad(item: ExecutionHandoffContractSnapshotItem): ObservedTriad {
    return {
        contractId: item.id,
        carrierKind: item.carrierKind,
        pathLabels: [...item.pathLabels],
        carrierPathClass: normalizeCarrierPathClass(item.pathLabels),
        activationToken: item.kernel.activation,
        payloadClass: normalizePayloadClass(item),
        captureClass: normalizeCaptureClass(item),
        resumeKind: item.ports.completion,
        preserveClass: normalizePreserveClass(item),
        deferred: item.kernel.domain === "deferred",
    };
}

function triadCoreMatches(expected: ExpectedTriad, observed: ObservedTriad): boolean {
    return expected.carrierPathClass === observed.carrierPathClass
        && expected.activationToken === observed.activationToken
        && expected.payloadClass === observed.payloadClass
        && expected.captureClass === observed.captureClass
        && expected.resumeKind === observed.resumeKind
        && expected.deferred === observed.deferred;
}

function triadExtendedMatches(expected: ExpectedTriad, observed: ObservedTriad): boolean {
    return triadCoreMatches(expected, observed)
        && expected.preserveClass === observed.preserveClass;
}

function triadScore(expected: ExpectedTriad, observed: ObservedTriad): number {
    let score = 0;
    if (expected.activationToken === observed.activationToken) score += 4;
    if (expected.carrierPathClass === observed.carrierPathClass) score += 3;
    if (expected.payloadClass === observed.payloadClass) score += 2;
    if (expected.captureClass === observed.captureClass) score += 2;
    if (expected.resumeKind === observed.resumeKind) score += 2;
    if (expected.deferred === observed.deferred) score += 1;
    if (expected.preserveClass === observed.preserveClass) score += 1;
    return score;
}

function chooseBestTriad(expected: ExpectedTriad, observed: ObservedTriad[]): { triad?: ObservedTriad; score: number } {
    let best: ObservedTriad | undefined;
    let bestScore = -1;
    for (const triad of observed) {
        const score = triadScore(expected, triad);
        if (score > bestScore) {
            best = triad;
            bestScore = score;
        }
    }
    return { triad: best, score: Math.max(bestScore, 0) };
}

function expectedSemanticKey(expected: ExpectedTriad): string {
    return [
        expected.activationToken,
        expected.payloadClass,
        expected.captureClass,
        expected.resumeKind,
        expected.preserveClass,
        expected.deferred ? "deferred" : "direct",
    ].join("|");
}

function observedSemanticKey(observed: ObservedTriad): string {
    return [
        observed.activationToken,
        observed.payloadClass,
        observed.captureClass,
        observed.resumeKind,
        observed.preserveClass,
        observed.deferred ? "deferred" : "direct",
    ].join("|");
}

async function runCaseAudit(
    manifestPath: string,
    spec: ExecutionHandoffCompareCase,
    caseViewRoot: string,
): Promise<CaseAuditResult> {
    const manifest = loadExecutionHandoffCompareManifest(manifestPath);
    const sourceDir = manifest.sourceDir;
    const projectDir = createIsolatedCaseView(path.resolve(sourceDir), spec.caseName, caseViewRoot);
    const scene = buildInferenceScene(projectDir);
    const relativePath = `${spec.caseName}.ets`;
    const entry = resolveCaseMethod(scene, relativePath, spec.caseName);
    const entryMethod = findCaseMethod(scene, entry);
    assert(!!entryMethod, `failed to resolve entry for ${spec.caseName}`);

    const engine = await buildEngineForCase(scene, 1, entryMethod!, {
        verbose: false,
        engineOptions: {
            deferredHandoffMode: "contract_active" as MainlineDeferredHandoffMode,
        },
    });
    const snapshot = engine.getExecutionHandoffContractSnapshot();
    const observedTriads = (snapshot?.contracts || []).map(mapObservedTriad);
    const expectedTriad = buildExpectedTriad(spec);
    const { triad: selectedTriad, score } = chooseBestTriad(expectedTriad, observedTriads);

    return {
        caseName: spec.caseName,
        semanticFamily: spec.semanticFamily || spec.twinGroup,
        layer: spec.layer,
        variantId: spec.variantId || spec.caseName,
        expectedTriad,
        observedTriads,
        selectedTriad,
        exactCoreMatch: !!selectedTriad && triadCoreMatches(expectedTriad, selectedTriad),
        exactExtendedMatch: !!selectedTriad && triadExtendedMatches(expectedTriad, selectedTriad),
        bestScore: score,
    };
}

function summarizeScope(
    manifestPath: string,
    results: CaseAuditResult[],
): ScopeAuditResult {
    const manifest = loadExecutionHandoffCompareManifest(manifestPath);
    const expectedByObserved = new Map<string, { expectedKeys: Set<string>; cases: Set<string> }>();

    for (const result of results) {
        if (!result.selectedTriad) {
            continue;
        }
        const observedKey = observedSemanticKey(result.selectedTriad);
        const expectedKey = expectedSemanticKey(result.expectedTriad);
        if (!expectedByObserved.has(observedKey)) {
            expectedByObserved.set(observedKey, { expectedKeys: new Set<string>(), cases: new Set<string>() });
        }
        expectedByObserved.get(observedKey)!.expectedKeys.add(expectedKey);
        expectedByObserved.get(observedKey)!.cases.add(result.caseName);
    }

    const semanticCollisionCount = [...expectedByObserved.values()]
        .filter(item => item.expectedKeys.size > 1)
        .length;

    const eventShapeCases = results.filter(item => item.semanticFamily === "event_capture_shape");
    const eventShapeSemanticKeys = new Set(
        eventShapeCases
            .map(item => item.selectedTriad)
            .filter((item): item is ObservedTriad => !!item)
            .map(observedSemanticKey),
    );
    const eventShapeCarrierByVariant = new Map<string, CarrierPathClass>();
    for (const item of eventShapeCases) {
        if (!item.selectedTriad) continue;
        eventShapeCarrierByVariant.set(item.variantId, item.selectedTriad.carrierPathClass);
    }
    const eventShapeSemanticInvariant = eventShapeSemanticKeys.size === 1;
    const eventShapeCarrierCollapsePass =
        eventShapeCarrierByVariant.get("field_carrier") === "load"
        && eventShapeCarrierByVariant.get("slot_carrier") === "load"
        && eventShapeCarrierByVariant.get("samefile_relay") === "pass*"
        && eventShapeCarrierByVariant.get("crossfile_relay") === "pass*";

    const controlCases = results.filter(item => item.layer === "boundary_control");
    const deferredControlSeparationPass = controlCases.every(item =>
        item.selectedTriad?.activationToken === "call(c)" && item.selectedTriad?.deferred === false,
    );

    return {
        manifestPath: path.resolve(manifestPath),
        scopeName: manifest.activeCompareScope.name,
        totalCases: results.length,
        exactCoreMatches: results.filter(item => item.exactCoreMatch).length,
        exactExtendedMatches: results.filter(item => item.exactExtendedMatch).length,
        semanticCollisionCount,
        deferredControlSeparationPass,
        eventShapeSemanticInvariant,
        eventShapeCarrierCollapsePass,
        results,
    };
}

function buildCollisionList(scopes: ScopeAuditResult[]): SemanticCollision[] {
    const merged = new Map<string, { expectedKeys: Set<string>; cases: Set<string> }>();
    for (const scope of scopes) {
        for (const result of scope.results) {
            if (!result.selectedTriad) continue;
            const observedKey = observedSemanticKey(result.selectedTriad);
            const expectedKey = expectedSemanticKey(result.expectedTriad);
            if (!merged.has(observedKey)) {
                merged.set(observedKey, { expectedKeys: new Set<string>(), cases: new Set<string>() });
            }
            merged.get(observedKey)!.expectedKeys.add(expectedKey);
            merged.get(observedKey)!.cases.add(result.caseName);
        }
    }
    return [...merged.entries()]
        .filter(([, item]) => item.expectedKeys.size > 1)
        .map(([observedSemanticKeyValue, item]) => ({
            observedSemanticKey: observedSemanticKeyValue,
            expectedSemanticKeys: [...item.expectedKeys].sort((a, b) => a.localeCompare(b)),
            cases: [...item.cases].sort((a, b) => a.localeCompare(b)),
        }))
        .sort((a, b) => a.observedSemanticKey.localeCompare(b.observedSemanticKey));
}

function renderMarkdown(report: UnificationAuditReport): string {
    const lines: string[] = [];
    lines.push("# Execution Handoff Unification Audit");
    lines.push("");
    lines.push("## Summary");
    lines.push("");
    lines.push(`- totalCases=${report.totalCases}`);
    lines.push(`- exactCoreCoverage=${report.exactCoreCoverage.toFixed(3)}`);
    lines.push(`- exactExtendedCoverage=${report.exactExtendedCoverage.toFixed(3)}`);
    lines.push(`- semanticCollisionCount=${report.semanticCollisionCount}`);
    lines.push(`- deferredControlSeparationPass=${report.deferredControlSeparationPass}`);
    lines.push(`- eventShapeSemanticInvariant=${report.eventShapeSemanticInvariant}`);
    lines.push(`- eventShapeCarrierCollapsePass=${report.eventShapeCarrierCollapsePass}`);
    lines.push("");
    lines.push("## Scopes");
    lines.push("");
    for (const scope of report.scopeSummaries) {
        lines.push(
            `- \`${scope.scopeName}\`: core=${scope.exactCoreMatches}/${scope.totalCases}, `
            + `extended=${scope.exactExtendedMatches}/${scope.totalCases}, `
            + `collisions=${scope.semanticCollisionCount}, `
            + `controlPass=${scope.deferredControlSeparationPass}, `
            + `shapeSemanticInvariant=${scope.eventShapeSemanticInvariant}, `
            + `shapeCarrierCollapse=${scope.eventShapeCarrierCollapsePass}`,
        );
    }
    lines.push("");
    if (report.collisions.length > 0) {
        lines.push("## Collisions");
        lines.push("");
        for (const collision of report.collisions) {
            lines.push(`- observed=\`${collision.observedSemanticKey}\``);
            lines.push(`  expected=${collision.expectedSemanticKeys.join(" ; ")}`);
            lines.push(`  cases=${collision.cases.join(", ")}`);
        }
        lines.push("");
    }
    lines.push("## Cases");
    lines.push("");
    for (const scope of report.results) {
        lines.push(`### ${scope.scopeName}`);
        lines.push("");
        for (const result of scope.results) {
            lines.push(`- \`${result.caseName}\``);
            lines.push(`  expected=${JSON.stringify(result.expectedTriad)}`);
            lines.push(`  selected=${JSON.stringify(result.selectedTriad || null)}`);
            lines.push(`  exactCoreMatch=${result.exactCoreMatch}, exactExtendedMatch=${result.exactExtendedMatch}, bestScore=${result.bestScore}`);
        }
        lines.push("");
    }
    return lines.join("\n");
}

async function main(): Promise<void> {
    const outputDir = path.resolve("tmp/test_runs/research/execution_handoff_unification_audit/latest");
    const caseViewRoot = path.join(outputDir, "case_views");
    ensureDir(caseViewRoot);

    const scopeResults: ScopeAuditResult[] = [];
    for (const manifestPath of MANIFESTS) {
        const manifest = loadExecutionHandoffCompareManifest(manifestPath);
        const cases = activeExecutionHandoffCompareCases(manifest);
        const results: CaseAuditResult[] = [];
        for (const spec of cases) {
            results.push(await runCaseAudit(manifestPath, spec, caseViewRoot));
        }
        scopeResults.push(summarizeScope(manifestPath, results));
    }

    const allResults = scopeResults.flatMap(scope => scope.results);
    const exactCoreMatches = allResults.filter(item => item.exactCoreMatch).length;
    const exactExtendedMatches = allResults.filter(item => item.exactExtendedMatch).length;
    const collisions = buildCollisionList(scopeResults);
    const deferredControlSeparationPass = scopeResults.every(scope => scope.deferredControlSeparationPass);
    const eventShapeSemanticInvariant = scopeResults
        .filter(scope => scope.scopeName === "event_handoff_shape_invariance")
        .every(scope => scope.eventShapeSemanticInvariant);
    const eventShapeCarrierCollapsePass = scopeResults
        .filter(scope => scope.scopeName === "event_handoff_shape_invariance")
        .every(scope => scope.eventShapeCarrierCollapsePass);

    const report: UnificationAuditReport = {
        generatedAt: new Date().toISOString(),
        manifests: MANIFESTS.map(item => path.resolve(item)),
        totalCases: allResults.length,
        exactCoreCoverage: allResults.length === 0 ? 0 : exactCoreMatches / allResults.length,
        exactExtendedCoverage: allResults.length === 0 ? 0 : exactExtendedMatches / allResults.length,
        semanticCollisionCount: collisions.length,
        deferredControlSeparationPass,
        eventShapeSemanticInvariant,
        eventShapeCarrierCollapsePass,
        collisions,
        scopeSummaries: scopeResults.map(scope => ({
            scopeName: scope.scopeName,
            totalCases: scope.totalCases,
            exactCoreMatches: scope.exactCoreMatches,
            exactExtendedMatches: scope.exactExtendedMatches,
            semanticCollisionCount: scope.semanticCollisionCount,
            deferredControlSeparationPass: scope.deferredControlSeparationPass,
            eventShapeSemanticInvariant: scope.eventShapeSemanticInvariant,
            eventShapeCarrierCollapsePass: scope.eventShapeCarrierCollapsePass,
        })),
        results: scopeResults,
    };

    fs.writeFileSync(
        path.join(outputDir, "execution_handoff_unification_audit.json"),
        JSON.stringify(report, null, 2),
        "utf8",
    );
    fs.writeFileSync(
        path.join(outputDir, "execution_handoff_unification_audit.md"),
        renderMarkdown(report),
        "utf8",
    );

    console.log("execution_handoff_unification_audit=PASS");
    console.log(`totalCases=${report.totalCases}`);
    console.log(`exactCoreCoverage=${report.exactCoreCoverage.toFixed(3)}`);
    console.log(`exactExtendedCoverage=${report.exactExtendedCoverage.toFixed(3)}`);
    console.log(`semanticCollisionCount=${report.semanticCollisionCount}`);
    console.log(`deferredControlSeparationPass=${report.deferredControlSeparationPass}`);
    console.log(`eventShapeSemanticInvariant=${report.eventShapeSemanticInvariant}`);
    console.log(`eventShapeCarrierCollapsePass=${report.eventShapeCarrierCollapsePass}`);
}

main().catch(err => {
    console.error("execution_handoff_unification_audit=FAIL");
    console.error(err);
    process.exitCode = 1;
});
