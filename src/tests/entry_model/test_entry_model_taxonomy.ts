import * as fs from "fs";
import * as path from "path";
import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../../arkanalyzer/out/src/Config";
import { TaintPropagationEngine } from "../../core/orchestration/TaintPropagationEngine";
import { buildPureEntryExpectationLookup, loadPureEntryExpectationSuites } from "../helpers/PureEntryExpectations";
import { buildPureEntryOracle, PureEntrySuiteCategory } from "../helpers/PureEntryOracle";
import { registerMockSdkFiles } from "../helpers/TestSceneBuilder";

interface SuiteSpec {
    id: string;
    category: PureEntrySuiteCategory;
    sourceDir: string;
    caseIncludePatterns?: string[];
    caseExcludePatterns?: string[];
}

interface TaxonomyManifest {
    suites: SuiteSpec[];
}

interface CaseResult {
    detected: boolean;
    pass: boolean;
    matchedValidTargets: string[];
    matchedBroadTargets: string[];
    implicitReachableCount: number;
    error?: string;
}

interface CaseReport {
    caseName: string;
    expected: boolean;
    excluded: boolean;
    notes: string[];
    validTargets: string[];
    broadTargets: string[];
    result: CaseResult;
}

interface SuiteReport {
    suite: string;
    category: PureEntrySuiteCategory;
    sourceDir: string;
    caseCount: number;
    scoredCaseCount: number;
    passCases: number;
    failCases: number;
    runtimeErrors: number;
    cases: CaseReport[];
}

function loadManifest(): TaxonomyManifest {
    return JSON.parse(
        fs.readFileSync(path.resolve("tests/manifests/entry_model/main_model_pure_entry_taxonomy.json"), "utf8"),
    ) as TaxonomyManifest;
}

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
        if (!isCaseFile && isSemanticCaseFile(fileName)) continue;
        fs.copyFileSync(path.join(sourceDir, fileName), path.join(caseDir, fileName));
    }
    return caseDir;
}

function listCases(sourceDir: string, spec: SuiteSpec): string[] {
    const includePatterns = (spec.caseIncludePatterns || []).map(pattern => new RegExp(pattern));
    const excludePatterns = (spec.caseExcludePatterns || []).map(pattern => new RegExp(pattern));
    return fs.readdirSync(sourceDir)
        .filter(file => file.endsWith(".ets"))
        .map(file => path.basename(file, ".ets"))
        .filter(name => /_(T|F)$/.test(name))
        .filter(name => includePatterns.length === 0 || includePatterns.some(pattern => pattern.test(name)))
        .filter(name => !excludePatterns.some(pattern => pattern.test(name)))
        .sort();
}

function methodRef(method: any): string {
    const className = method.getDeclaringArkClass?.()?.getName?.() || "@global";
    return `${className}.${method.getName()}`;
}

function buildSignatureToRefMap(scene: Scene): Map<string, string> {
    const map = new Map<string, string>();
    for (const method of scene.getMethods()) {
        const signature = method.getSignature?.()?.toString?.();
        if (signature) map.set(signature, methodRef(method));
    }
    return map;
}

async function runPureEntryCase(
    projectDir: string,
    category: PureEntrySuiteCategory,
    entryExpectation: boolean,
): Promise<CaseResult & { excluded: boolean; notes: string[]; validTargets: string[]; broadTargets: string[] }> {
    const scene = buildScene(projectDir);
    const oracle = buildPureEntryOracle(scene, category, entryExpectation);
    if (oracle.classification === "excluded") {
        return {
            detected: false,
            pass: true,
            matchedValidTargets: [],
            matchedBroadTargets: [],
            implicitReachableCount: 0,
            excluded: true,
            notes: oracle.notes,
            validTargets: oracle.validTargets,
            broadTargets: oracle.broadTargets,
        };
    }

    const engine = new TaintPropagationEngine(scene, 1);
    engine.verbose = false;
    await engine.buildPAG({ entryModel: "arkMain" });

    const signatureToRef = buildSignatureToRefMap(scene);
    const reachable = engine.computeReachableMethodSignatures();
    const implicitReachableRefs = [...reachable]
        .map(signature => signatureToRef.get(signature))
        .filter((ref): ref is string => !!ref);
    const implicitReachableSet = new Set<string>(implicitReachableRefs);
    const matchedValidTargets = oracle.validTargets.filter(target => implicitReachableSet.has(target));
    const matchedBroadTargets = oracle.broadTargets.filter(target => implicitReachableSet.has(target));
    const detected = oracle.classification === "positive"
        ? matchedValidTargets.length > 0
        : matchedBroadTargets.length > 0;

    return {
        detected,
        pass: oracle.classification === "positive" ? detected : !detected,
        matchedValidTargets,
        matchedBroadTargets,
        implicitReachableCount: implicitReachableSet.size,
        excluded: false,
        notes: oracle.notes,
        validTargets: oracle.validTargets,
        broadTargets: oracle.broadTargets,
    };
}

async function main(): Promise<void> {
    const outputDir = path.resolve("tmp/test_runs/entry_model/main_model_taxonomy/latest");
    const outputPath = path.join(outputDir, "main_model_taxonomy_report.json");
    const caseViewRoot = path.join(outputDir, "case_views");
    ensureDir(outputDir);
    ensureDir(caseViewRoot);

    const manifest = loadManifest();
    const expectationSuites = loadPureEntryExpectationSuites();
    const suiteReports: SuiteReport[] = [];

    for (const spec of manifest.suites) {
        const sourceDir = path.resolve(spec.sourceDir);
        const cases = listCases(sourceDir, spec);
        const expectationLookup = buildPureEntryExpectationLookup(spec.id, cases, expectationSuites);
        const caseReports: CaseReport[] = [];
        const suiteCaseViewRoot = path.join(caseViewRoot, spec.id);
        ensureDir(suiteCaseViewRoot);

        for (const caseName of cases) {
            const caseProjectDir = createCaseView(sourceDir, caseName, suiteCaseViewRoot);
            const entryExpectation = expectationLookup.get(caseName);
            if (entryExpectation === undefined) {
                throw new Error(`missing explicit pure-entry expectation for ${spec.id}/${caseName}`);
            }

            try {
                const result = await runPureEntryCase(caseProjectDir, spec.category, entryExpectation);
                caseReports.push({
                    caseName,
                    expected: entryExpectation,
                    excluded: result.excluded,
                    notes: result.notes,
                    validTargets: result.validTargets,
                    broadTargets: result.broadTargets,
                    result,
                });
            } catch (error) {
                caseReports.push({
                    caseName,
                    expected: entryExpectation,
                    excluded: false,
                    notes: [],
                    validTargets: [],
                    broadTargets: [],
                    result: {
                        detected: false,
                        pass: false,
                        matchedValidTargets: [],
                        matchedBroadTargets: [],
                        implicitReachableCount: 0,
                        error: error instanceof Error ? error.message : String(error),
                    },
                });
            }
        }

        const scoredCases = caseReports.filter(item => !item.excluded);
        const passCases = scoredCases.filter(item => item.result.pass && !item.result.error).length;
        const runtimeErrors = scoredCases.filter(item => !!item.result.error).length;
        suiteReports.push({
            suite: spec.id,
            category: spec.category,
            sourceDir: spec.sourceDir,
            caseCount: caseReports.length,
            scoredCaseCount: scoredCases.length,
            passCases,
            failCases: scoredCases.length - passCases,
            runtimeErrors,
            cases: caseReports,
        });
    }

    const totalScoredCases = suiteReports.reduce((sum, report) => sum + report.scoredCaseCount, 0);
    const totalPassCases = suiteReports.reduce((sum, report) => sum + report.passCases, 0);
    const totalRuntimeErrors = suiteReports.reduce((sum, report) => sum + report.runtimeErrors, 0);
    const report = {
        benchmarkKind: "pure_entry_taxonomy_arkmain",
        manifest: "tests/manifests/entry_model/main_model_pure_entry_taxonomy.json",
        suiteCount: suiteReports.length,
        totalScoredCases,
        totalPassCases,
        totalRuntimeErrors,
        suites: suiteReports,
    };
    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), "utf8");

    console.log("PASS test_entry_model_taxonomy");
    console.log(`report=${outputPath}`);
    console.log(`arkMain=${totalPassCases}/${totalScoredCases}`);

    if (totalRuntimeErrors > 0) {
        throw new Error(`taxonomy runtime errors detected: ${totalRuntimeErrors}`);
    }
    if (totalPassCases !== totalScoredCases) {
        throw new Error(`arkMain taxonomy regression: ${totalPassCases}/${totalScoredCases}`);
    }
}

main().catch(error => {
    console.error("FAIL test_entry_model_taxonomy");
    console.error(error);
    process.exit(1);
});


