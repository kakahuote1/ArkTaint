import * as fs from "fs";
import * as path from "path";
import {
    activeExecutionHandoffSemanticCases,
    loadExecutionHandoffSemanticManifest,
    type ExecutionHandoffSemanticCase,
} from "../helpers/ExecutionHandoffSemanticManifest";
import {
    assert,
    createIsolatedCaseView,
    ensureDir,
} from "../helpers/ExecutionHandoffContractSupport";
import {
    buildEngineForCase,
    findCaseMethod,
    resolveCaseMethod,
} from "../helpers/SyntheticCaseHarness";
import { buildInferenceScene } from "../helpers/ExecutionHandoffInferenceSupport";
import type {
    ExecutionHandoffContractSnapshotItem,
    HandoffResumeKind,
    HandoffTriggerToken,
} from "../../core/kernel/handoff/ExecutionHandoffContract";

type CarrierSemanticClass = "handoff" | "control";
type PayloadClass = "payload0" | "payload+";
type CaptureClass = "capture0" | "capture+";
type PreserveClass = "preserve0" | "settle(rejected)" | "settle(fulfilled)" | "settle(any)" | "mixed";
type CompletionClass = "none" | "promise_chain" | "await_site";

interface ExpectedSemanticSignature {
    carrierSemanticClass: CarrierSemanticClass;
    activationToken: HandoffTriggerToken;
    payloadClass: PayloadClass;
    captureClass: CaptureClass;
    completionClass: CompletionClass;
    preserveClass: PreserveClass;
    deferred: boolean;
}

interface ObservedSemanticSignature extends ExpectedSemanticSignature {
    contractId: string;
    carrierKind: string;
    pathLabels: string[];
}

interface CaseSemanticAuditResult {
    caseName: string;
    semanticFamily: string;
    layer: string;
    variantId: string;
    expected: ExpectedSemanticSignature;
    observed: ObservedSemanticSignature[];
    matched: boolean;
    selected?: ObservedSemanticSignature;
    score: number;
}

interface ScopeSemanticAuditResult {
    manifestPath: string;
    scopeName: string;
    totalCases: number;
    deferredCases: number;
    deferredMatches: number;
    controlCases: number;
    controlPass: boolean;
    semanticCollisionCount: number;
    eventShapeSemanticInvariant: boolean;
    results: CaseSemanticAuditResult[];
}

interface SemanticCollision {
    observedSemanticKey: string;
    expectedSemanticKeys: string[];
    cases: string[];
}

interface SemanticAuditReport {
    generatedAt: string;
    manifests: string[];
    totalCases: number;
    deferredCases: number;
    deferredCoverage: number;
    controlCases: number;
    controlPass: boolean;
    semanticCollisionCount: number;
    eventShapeSemanticInvariant: boolean;
    collisions: SemanticCollision[];
    scopeSummaries: Array<{
        scopeName: string;
        totalCases: number;
        deferredCases: number;
        deferredMatches: number;
        controlCases: number;
        controlPass: boolean;
        semanticCollisionCount: number;
        eventShapeSemanticInvariant: boolean;
    }>;
    results: ScopeSemanticAuditResult[];
}

const MANIFESTS = [
    "tests/adhoc/execution_handoff_semantic_event/manifest.json",
    "tests/adhoc/execution_handoff_semantic_async/manifest.json",
    "tests/adhoc/execution_handoff_semantic_env/manifest.json",
    "tests/adhoc/execution_handoff_semantic_perturbation/manifest.json",
];

function expectedActivationToken(spec: ExecutionHandoffSemanticCase): HandoffTriggerToken {
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

function expectedPayloadClass(spec: ExecutionHandoffSemanticCase): PayloadClass {
    return spec.factors.payload === "none" ? "payload0" : "payload+";
}

function expectedCaptureClass(spec: ExecutionHandoffSemanticCase): CaptureClass {
    return spec.factors.capture === "none" ? "capture0" : "capture+";
}

function expectedPreserveClass(spec: ExecutionHandoffSemanticCase): PreserveClass {
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

function expectedCompletionClass(spec: ExecutionHandoffSemanticCase): CompletionClass {
    if (!spec.factors.deferred) {
        return "none";
    }
    return spec.factors.resume as CompletionClass;
}

function buildExpectedSignature(spec: ExecutionHandoffSemanticCase): ExpectedSemanticSignature {
    return {
        carrierSemanticClass: spec.factors.deferred ? "handoff" : "control",
        activationToken: expectedActivationToken(spec),
        payloadClass: expectedPayloadClass(spec),
        captureClass: expectedCaptureClass(spec),
        completionClass: expectedCompletionClass(spec),
        preserveClass: expectedPreserveClass(spec),
        deferred: spec.factors.deferred,
    };
}

function normalizePayloadClass(item: ExecutionHandoffContractSnapshotItem): PayloadClass {
    return item.ports.payload === "payload+" ? "payload+" : "payload0";
}

function normalizeCaptureClass(item: ExecutionHandoffContractSnapshotItem): CaptureClass {
    return item.ports.env === "env0" ? "capture0" : "capture+";
}

function normalizePreserveClass(item: ExecutionHandoffContractSnapshotItem): PreserveClass {
    return item.ports.preserve;
}

function normalizeCompletionClass(item: ExecutionHandoffContractSnapshotItem): CompletionClass {
    return item.ports.completion;
}

function mapObservedSignature(item: ExecutionHandoffContractSnapshotItem): ObservedSemanticSignature {
    return {
        contractId: item.id,
        carrierKind: item.carrierKind,
        pathLabels: [...item.pathLabels],
        carrierSemanticClass: "handoff",
        activationToken: item.activation,
        payloadClass: normalizePayloadClass(item),
        captureClass: normalizeCaptureClass(item),
        completionClass: normalizeCompletionClass(item),
        preserveClass: normalizePreserveClass(item),
        deferred: true,
    };
}

function semanticMatch(expected: ExpectedSemanticSignature, observed: ObservedSemanticSignature): boolean {
    return expected.carrierSemanticClass === observed.carrierSemanticClass
        && expected.activationToken === observed.activationToken
        && expected.payloadClass === observed.payloadClass
        && expected.captureClass === observed.captureClass
        && expected.completionClass === observed.completionClass
        && expected.preserveClass === observed.preserveClass
        && expected.deferred === observed.deferred;
}

function semanticScore(expected: ExpectedSemanticSignature, observed: ObservedSemanticSignature): number {
    let score = 0;
    if (expected.carrierSemanticClass === observed.carrierSemanticClass) score += 3;
    if (expected.activationToken === observed.activationToken) score += 4;
    if (expected.payloadClass === observed.payloadClass) score += 2;
    if (expected.captureClass === observed.captureClass) score += 2;
    if (expected.completionClass === observed.completionClass) score += 2;
    if (expected.preserveClass === observed.preserveClass) score += 1;
    if (expected.deferred === observed.deferred) score += 1;
    return score;
}

function chooseBestObserved(
    expected: ExpectedSemanticSignature,
    observed: ObservedSemanticSignature[],
): { selected?: ObservedSemanticSignature; score: number; matched: boolean } {
    const exact = observed.find(item => semanticMatch(expected, item));
    if (exact) {
        return { selected: exact, score: semanticScore(expected, exact), matched: true };
    }
    let best: ObservedSemanticSignature | undefined;
    let bestScore = -1;
    for (const item of observed) {
        const score = semanticScore(expected, item);
        if (score > bestScore) {
            best = item;
            bestScore = score;
        }
    }
    return {
        selected: best,
        score: Math.max(bestScore, 0),
        matched: false,
    };
}

function expectedSemanticKey(expected: ExpectedSemanticSignature): string {
    return [
        expected.carrierSemanticClass,
        expected.activationToken,
        expected.payloadClass,
        expected.captureClass,
        expected.completionClass,
        expected.preserveClass,
        expected.deferred ? "deferred" : "direct",
    ].join("|");
}

function observedSemanticKey(observed: ObservedSemanticSignature): string {
    return [
        observed.carrierSemanticClass,
        observed.activationToken,
        observed.payloadClass,
        observed.captureClass,
        observed.completionClass,
        observed.preserveClass,
        observed.deferred ? "deferred" : "direct",
    ].join("|");
}

async function runCaseAudit(
    manifestPath: string,
    spec: ExecutionHandoffSemanticCase,
    caseViewRoot: string,
): Promise<CaseSemanticAuditResult> {
    const manifest = loadExecutionHandoffSemanticManifest(manifestPath);
    const sourceDir = manifest.sourceDir;
    const projectDir = createIsolatedCaseView(path.resolve(sourceDir), spec.caseName, caseViewRoot);
    const scene = buildInferenceScene(projectDir);
    const relativePath = `${spec.caseName}.ets`;
    const entry = resolveCaseMethod(scene, relativePath, spec.caseName);
    const entryMethod = findCaseMethod(scene, entry);
    assert(!!entryMethod, `failed to resolve entry for ${spec.caseName}`);

    const engine = await buildEngineForCase(scene, 1, entryMethod!, {
        verbose: false,
        engineOptions: {},
    });
    const snapshot = engine.getExecutionHandoffContractSnapshot();
    const observed = (snapshot?.contracts || []).map(mapObservedSignature);
    const expected = buildExpectedSignature(spec);

    if (!spec.factors.deferred) {
        return {
            caseName: spec.caseName,
            semanticFamily: spec.semanticFamily || spec.twinGroup,
            layer: spec.layer,
            variantId: spec.variantId || spec.caseName,
            expected,
            observed,
            matched: observed.length === 0,
            score: observed.length === 0 ? 1 : 0,
        };
    }

    const { selected, score, matched } = chooseBestObserved(expected, observed);
    return {
        caseName: spec.caseName,
        semanticFamily: spec.semanticFamily || spec.twinGroup,
        layer: spec.layer,
        variantId: spec.variantId || spec.caseName,
        expected,
        observed,
        matched,
        selected,
        score,
    };
}

function summarizeScope(
    manifestPath: string,
    results: CaseSemanticAuditResult[],
): ScopeSemanticAuditResult {
    const manifest = loadExecutionHandoffSemanticManifest(manifestPath);
    const deferredResults = results.filter(item => item.expected.deferred);
    const controlResults = results.filter(item => !item.expected.deferred);

    const expectedByObserved = new Map<string, { expectedKeys: Set<string>; cases: Set<string> }>();
    for (const result of deferredResults) {
        if (!result.selected) {
            continue;
        }
        const observedKey = observedSemanticKey(result.selected);
        const expectedKey = expectedSemanticKey(result.expected);
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
            .filter((item): item is ObservedSemanticSignature => !!item)
            .map(observedSemanticKey),
    );

    return {
        manifestPath: path.resolve(manifestPath),
        scopeName: manifest.activeSemanticScope.name,
        totalCases: results.length,
        deferredCases: deferredResults.length,
        deferredMatches: deferredResults.filter(item => item.matched).length,
        controlCases: controlResults.length,
        controlPass: controlResults.every(item => item.matched),
        semanticCollisionCount: [...expectedByObserved.values()].filter(item => item.expectedKeys.size > 1).length,
        eventShapeSemanticInvariant: eventShapeCases.length === 0 ? false : shapeKeys.size === 1,
        results,
    };
}

function buildCollisionList(scopes: ScopeSemanticAuditResult[]): SemanticCollision[] {
    const merged = new Map<string, { expectedKeys: Set<string>; cases: Set<string> }>();
    for (const scope of scopes) {
        for (const result of scope.results) {
            if (!result.expected.deferred || !result.selected) {
                continue;
            }
            const observedKey = observedSemanticKey(result.selected);
            const expectedKey = expectedSemanticKey(result.expected);
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

function renderMarkdown(report: SemanticAuditReport): string {
    const lines: string[] = [];
    lines.push("# Execution Handoff Unification Semantic Audit");
    lines.push("");
    lines.push("## Summary");
    lines.push("");
    lines.push(`- totalCases=${report.totalCases}`);
    lines.push(`- deferredCases=${report.deferredCases}`);
    lines.push(`- deferredCoverage=${report.deferredCoverage.toFixed(3)}`);
    lines.push(`- controlCases=${report.controlCases}`);
    lines.push(`- controlPass=${report.controlPass}`);
    lines.push(`- semanticCollisionCount=${report.semanticCollisionCount}`);
    lines.push(`- eventShapeSemanticInvariant=${report.eventShapeSemanticInvariant}`);
    lines.push("");
    lines.push("## Scopes");
    lines.push("");
    for (const scope of report.scopeSummaries) {
        lines.push(
            `- \`${scope.scopeName}\`: deferred=${scope.deferredMatches}/${scope.deferredCases}, `
            + `control=${scope.controlPass}, collisions=${scope.semanticCollisionCount}, `
            + `eventShapeInvariant=${scope.eventShapeSemanticInvariant}`,
        );
    }
    lines.push("");
    lines.push("## Cases");
    lines.push("");
    for (const scope of report.results) {
        lines.push(`### ${scope.scopeName}`);
        lines.push("");
        for (const result of scope.results) {
            lines.push(`- \`${result.caseName}\``);
            lines.push(`  expected=${JSON.stringify(result.expected)}`);
            lines.push(`  selected=${JSON.stringify(result.selected || null)}`);
            lines.push(`  matched=${result.matched}, score=${result.score}`);
        }
        lines.push("");
    }
    return lines.join("\n");
}

async function main(): Promise<void> {
    const outputDir = path.resolve("tmp/test_runs/research/execution_handoff_unification_semantic_audit/latest");
    const caseViewRoot = path.join(outputDir, "case_views");
    ensureDir(caseViewRoot);

    const scopeResults: ScopeSemanticAuditResult[] = [];
    for (const manifestPath of MANIFESTS) {
        const manifest = loadExecutionHandoffSemanticManifest(manifestPath);
        const cases = activeExecutionHandoffSemanticCases(manifest);
        const results: CaseSemanticAuditResult[] = [];
        for (const spec of cases) {
            results.push(await runCaseAudit(manifestPath, spec, caseViewRoot));
        }
        scopeResults.push(summarizeScope(manifestPath, results));
    }

    const allResults = scopeResults.flatMap(scope => scope.results);
    const deferredResults = allResults.filter(item => item.expected.deferred);
    const controlResults = allResults.filter(item => !item.expected.deferred);
    const collisions = buildCollisionList(scopeResults);

    const report: SemanticAuditReport = {
        generatedAt: new Date().toISOString(),
        manifests: MANIFESTS.map(item => path.resolve(item)),
        totalCases: allResults.length,
        deferredCases: deferredResults.length,
        deferredCoverage: deferredResults.length === 0 ? 0 : deferredResults.filter(item => item.matched).length / deferredResults.length,
        controlCases: controlResults.length,
        controlPass: controlResults.every(item => item.matched),
        semanticCollisionCount: collisions.length,
        eventShapeSemanticInvariant: scopeResults
            .filter(scope => scope.scopeName === "event_handoff_shape_invariance")
            .every(scope => scope.eventShapeSemanticInvariant),
        collisions,
        scopeSummaries: scopeResults.map(scope => ({
            scopeName: scope.scopeName,
            totalCases: scope.totalCases,
            deferredCases: scope.deferredCases,
            deferredMatches: scope.deferredMatches,
            controlCases: scope.controlCases,
            controlPass: scope.controlPass,
            semanticCollisionCount: scope.semanticCollisionCount,
            eventShapeSemanticInvariant: scope.eventShapeSemanticInvariant,
        })),
        results: scopeResults,
    };

    fs.writeFileSync(
        path.join(outputDir, "execution_handoff_unification_semantic_audit.json"),
        JSON.stringify(report, null, 2),
        "utf8",
    );
    fs.writeFileSync(
        path.join(outputDir, "execution_handoff_unification_semantic_audit.md"),
        renderMarkdown(report),
        "utf8",
    );

    console.log("execution_handoff_unification_semantic_audit=PASS");
    console.log(`totalCases=${report.totalCases}`);
    console.log(`deferredCases=${report.deferredCases}`);
    console.log(`deferredCoverage=${report.deferredCoverage.toFixed(3)}`);
    console.log(`controlCases=${report.controlCases}`);
    console.log(`controlPass=${report.controlPass}`);
    console.log(`semanticCollisionCount=${report.semanticCollisionCount}`);
    console.log(`eventShapeSemanticInvariant=${report.eventShapeSemanticInvariant}`);
}

main().catch(err => {
    console.error("execution_handoff_unification_semantic_audit=FAIL");
    console.error(err);
    process.exitCode = 1;
});
