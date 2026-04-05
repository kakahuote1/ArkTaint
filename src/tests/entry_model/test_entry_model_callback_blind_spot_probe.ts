import * as fs from "fs";
import * as path from "path";
import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../../arkanalyzer/out/src/Config";
import {
    resolveKnownFrameworkCallbackRegistration,
    resolveKnownFrameworkCallbackRegistrationWithPolicy,
} from "../../core/entry/shared/FrameworkCallbackClassifier";
import { resolveMethodsFromCallable } from "../../core/substrate/queries/CalleeResolver";
import { registerMockSdkFiles } from "../helpers/TestSceneBuilder";

interface ProbeCaseView {
    caseName: string;
    sourceDir: string;
}

interface BlindSpotRecord {
    caseName: string;
    sourceMethodSignature: string;
    sourceMethodName: string;
    registrationSignature: string;
    registrationMethodName: string;
    registrationOwnerName: string;
    registrationClassText: string;
    registrationFileText: string;
    registrationProjectName: string;
    registrationNamespaceText: string;
    hasSdkFile: boolean;
    ownerEmpty: boolean;
    callableArgIndexes: number[];
    baselineRecognized: boolean;
    baselineLayer?: string;
    baselineShape?: string;
    baselineSlotFamily?: string;
    maskedRecognized: boolean;
    maskedLayer?: string;
    maskedShape?: string;
    maskedSlotFamily?: string;
}

interface CoverageCounter {
    baseline: number;
    masked: number;
}

interface BlindSpotReport {
    generatedAt: string;
    sourceDir: string;
    caseCount: number;
    candidateCount: number;
    sdkBackedCandidateCount: number;
    baselineRecognizedCount: number;
    maskedRecognizedCount: number;
    baselineCatalogClassifiedCount: number;
    maskedCatalogBlindSpotSuccessCount: number;
    uncataloguedSdkDiscoveryCount: number;
    coverageByBaselineSlotFamily: Record<string, CoverageCounter>;
    lostAfterMask: BlindSpotRecord[];
    openDiscoverySamples: BlindSpotRecord[];
    survivingCatalogMaskSamples: BlindSpotRecord[];
}

const CALLBACK_RESOLVE_OPTIONS = {
    maxCandidates: 8,
    enableLocalBacktrace: true,
    maxBacktraceSteps: 5,
    maxVisitedDefs: 16,
};

const CATALOG_MASK_POLICY = {
    enableSdkProvenance: true,
    enableOwnerQualifiedFallback: false,
    enableEmptyOwnerFallback: false,
    suppressCatalogSlotFamilyInference: true,
} as const;

function ensureDir(dir: string): void {
    fs.mkdirSync(dir, { recursive: true });
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

function hasSdkLikeImports(projectDir: string): boolean {
    for (const entry of fs.readdirSync(projectDir, { withFileTypes: true })) {
        if (!entry.isFile()) continue;
        if (!/\.(ets|ts)$/.test(entry.name)) continue;
        const text = fs.readFileSync(path.join(projectDir, entry.name), "utf8");
        if (/@ohos|@kit/.test(text)) {
            return true;
        }
    }
    return false;
}

function buildScene(projectDir: string): Scene {
    const config = new SceneConfig();
    const harmonySdkDir = path.resolve("arkanalyzer/tests/resources/Sdk");
    if (fs.existsSync(harmonySdkDir) && hasSdkLikeImports(projectDir)) {
        config.getSdksObj().push({
            moduleName: "",
            name: "harmony-sdk",
            path: harmonySdkDir,
        });
    }
    config.buildFromProjectDir(projectDir);
    const scene = new Scene();
    scene.buildSceneFromProjectDir(config);
    scene.inferTypes();
    registerMockSdkFiles(scene);
    return scene;
}

function listProbeCases(sourceDir: string): ProbeCaseView[] {
    return fs.readdirSync(sourceDir)
        .filter(file => file.endsWith(".ets"))
        .map(file => path.basename(file, ".ets"))
        .filter(name => /_(T|F)$/.test(name))
        .sort((left, right) => left.localeCompare(right))
        .map(caseName => ({ caseName, sourceDir }));
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

function analyzeCase(scene: Scene, caseName: string): BlindSpotRecord[] {
    const records: BlindSpotRecord[] = [];
    for (const method of scene.getMethods()) {
        const cfg = method.getCfg?.();
        if (!cfg) continue;
        for (const stmt of cfg.getStmts()) {
            const invokeExpr = stmt?.getInvokeExpr?.();
            if (!invokeExpr) continue;
            const explicitArgs = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
            const callableArgIndexes = findCallableArgIndexes(scene, explicitArgs);
            if (callableArgIndexes.length === 0) {
                continue;
            }

            const matcherArgs = {
                invokeExpr,
                explicitArgs,
                scene,
                sourceMethod: method,
            };
            const baseline = resolveKnownFrameworkCallbackRegistration(matcherArgs);
            const masked = resolveKnownFrameworkCallbackRegistrationWithPolicy(
                matcherArgs,
                CATALOG_MASK_POLICY,
            );
            const methodSig = invokeExpr.getMethodSignature?.();
            const classSig = methodSig?.getDeclaringClassSignature?.();
            const fileSig = classSig?.getDeclaringFileSignature?.();
            const hasSdkFile = !!fileSig && scene.hasSdkFile(fileSig);

            records.push({
                caseName,
                sourceMethodSignature: method.getSignature?.()?.toString?.() || "",
                sourceMethodName: method.getName?.() || "",
                registrationSignature: methodSig?.toString?.() || "",
                registrationMethodName: methodSig?.getMethodSubSignature?.()?.getMethodName?.() || "",
                registrationOwnerName: classSig?.getClassName?.() || "",
                registrationClassText: classSig?.toString?.() || "",
                registrationFileText: fileSig?.toString?.() || "",
                registrationProjectName: fileSig?.getProjectName?.() || "",
                registrationNamespaceText: classSig?.getDeclaringNamespaceSignature?.()?.toString?.() || "",
                hasSdkFile,
                ownerEmpty: (classSig?.getClassName?.() || "").length === 0,
                callableArgIndexes,
                baselineRecognized: !!baseline,
                baselineLayer: baseline?.recognitionLayer,
                baselineShape: baseline?.registrationShape,
                baselineSlotFamily: baseline?.slotFamily,
                maskedRecognized: !!masked,
                maskedLayer: masked?.recognitionLayer,
                maskedShape: masked?.registrationShape,
                maskedSlotFamily: masked?.slotFamily,
            });
        }
    }
    return records;
}

function pushSample(bucket: BlindSpotRecord[], record: BlindSpotRecord, max = 12): void {
    if (bucket.length >= max) return;
    bucket.push(record);
}

function bumpCoverage(
    map: Record<string, CoverageCounter>,
    key: string,
    maskedRecognized: boolean,
): void {
    if (!map[key]) {
        map[key] = { baseline: 0, masked: 0 };
    }
    map[key].baseline += 1;
    if (maskedRecognized) {
        map[key].masked += 1;
    }
}

function main(): void {
    const sourceDir = path.resolve("tests/demo/sdk_callback_provenance_probe");
    const outputRoot = path.resolve("tmp/test_runs/entry_model/callback_blind_spot_probe/latest");
    ensureDir(outputRoot);

    const caseViews = listProbeCases(sourceDir);
    const report: BlindSpotReport = {
        generatedAt: new Date().toISOString(),
        sourceDir,
        caseCount: caseViews.length,
        candidateCount: 0,
        sdkBackedCandidateCount: 0,
        baselineRecognizedCount: 0,
        maskedRecognizedCount: 0,
        baselineCatalogClassifiedCount: 0,
        maskedCatalogBlindSpotSuccessCount: 0,
        uncataloguedSdkDiscoveryCount: 0,
        coverageByBaselineSlotFamily: {},
        lostAfterMask: [],
        openDiscoverySamples: [],
        survivingCatalogMaskSamples: [],
    };

    const caseViewRoot = path.join(outputRoot, "case_views");
    ensureDir(caseViewRoot);

    for (const { caseName } of caseViews) {
        const projectDir = createCaseView(sourceDir, caseName, caseViewRoot);
        const scene = buildScene(projectDir);
        const records = analyzeCase(scene, caseName);
        for (const record of records) {
            report.candidateCount += 1;
            if (!record.hasSdkFile) {
                continue;
            }

            report.sdkBackedCandidateCount += 1;
            if (record.baselineLayer && record.baselineLayer !== "sdk_provenance") {
                throw new Error(`SDK-backed record unexpectedly resolved via ${record.baselineLayer}: ${record.registrationSignature}`);
            }
            if (record.maskedRecognized && record.maskedLayer !== "sdk_provenance") {
                throw new Error(`Catalog-masked record unexpectedly resolved via ${record.maskedLayer}: ${record.registrationSignature}`);
            }

            if (record.baselineRecognized) {
                report.baselineRecognizedCount += 1;
                const coverageKey = record.baselineSlotFamily || "@uncategorized";
                bumpCoverage(report.coverageByBaselineSlotFamily, coverageKey, record.maskedRecognized);
                if (record.baselineSlotFamily) {
                    report.baselineCatalogClassifiedCount += 1;
                }
            }
            if (record.maskedRecognized) {
                report.maskedRecognizedCount += 1;
            }
            if (record.baselineRecognized && record.baselineSlotFamily && record.maskedRecognized) {
                report.maskedCatalogBlindSpotSuccessCount += 1;
                pushSample(report.survivingCatalogMaskSamples, record);
            }
            if (record.baselineRecognized && !record.baselineSlotFamily && record.maskedRecognized) {
                report.uncataloguedSdkDiscoveryCount += 1;
                pushSample(report.openDiscoverySamples, record);
            }
            if (record.baselineRecognized && !record.maskedRecognized) {
                pushSample(report.lostAfterMask, record);
            }
        }
    }

    if (report.sdkBackedCandidateCount === 0) {
        throw new Error("Blind-spot probe produced no sdkBacked callback candidates.");
    }
    if (report.maskedRecognizedCount === 0) {
        throw new Error("Catalog-masked blind-spot probe found no sdk_provenance survivors.");
    }
    if (report.baselineCatalogClassifiedCount === 0) {
        throw new Error("Blind-spot probe found no sdk-backed callbacks that were catalog-classified at baseline.");
    }
    if (report.maskedCatalogBlindSpotSuccessCount === 0) {
        throw new Error("Catalog-masked blind-spot probe found no baseline catalog hits that survived mask via sdk_provenance.");
    }
    if (report.uncataloguedSdkDiscoveryCount === 0) {
        throw new Error("Blind-spot probe found no uncatalogued sdk callback discoveries.");
    }

    const reportPath = path.join(outputRoot, "callback_blind_spot_report.json");
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");
    console.log(`Callback blind-spot report written to ${reportPath}`);
    console.log(
        `sdk_backed=${report.sdkBackedCandidateCount}, baseline=${report.baselineRecognizedCount}, `
        + `masked=${report.maskedRecognizedCount}, baseline_catalog_classified=${report.baselineCatalogClassifiedCount}, `
        + `masked_catalog_survivors=${report.maskedCatalogBlindSpotSuccessCount}, `
        + `uncatalogued_sdk_discoveries=${report.uncataloguedSdkDiscoveryCount}`,
    );
}

main();

