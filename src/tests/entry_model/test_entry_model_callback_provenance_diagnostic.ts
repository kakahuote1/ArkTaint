import * as fs from "fs";
import * as path from "path";
import { Scene } from "../../../arkanalyzer/lib/Scene";
import { SceneConfig } from "../../../arkanalyzer/lib/Config";
import { resolveCallbackRegistrationsFromStmt } from "../../core/substrate/queries/CallbackBindingQuery";
import {
    resolveKnownChannelCallbackRegistration,
    resolveKnownControllerOptionCallbackRegistrationsFromStmt,
    resolveKnownFrameworkCallbackRegistration,
    resolveKnownKeyedCallbackRegistrationsFromStmt,
    resolveKnownSchedulerCallbackRegistration,
} from "../../core/entry/shared/FrameworkCallbackClassifier";
import { resolveMethodsFromCallable } from "../../core/substrate/queries/CalleeResolver";
import { createIsolatedCaseView } from "../helpers/ExecutionHandoffContractSupport";
import { registerMockSdkFiles } from "../helpers/TestSceneBuilder";

interface PureEntrySuiteSpec {
    id: string;
    category: string;
    sourceDir: string;
    caseIncludePatterns?: string[];
    caseExcludePatterns?: string[];
}

interface PureEntryManifest {
    suites: PureEntrySuiteSpec[];
}

interface DatasetSpec {
    id: string;
    caseViews: Array<{
        caseName: string;
        sourceDir: string;
    }>;
}

interface OptionsFieldProbe {
    argIndex: number;
    fieldNames: string[];
}

interface CallbackCandidateRecord {
    datasetId: string;
    caseName: string;
    sourceDir: string;
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
    shape: string;
    callableArgIndexes: number[];
    stringArgIndexes: number[];
    optionsFieldProbes: OptionsFieldProbe[];
    recognizedFamilies: string[];
    recognizedLayers: string[];
    recognizedShapes: string[];
    recognizedSlotFamilies: string[];
}

interface DatasetAggregate {
    caseCount: number;
    sdkImportCaseCount: number;
    candidateCount: number;
    recognizedCount: number;
    sdkBackedCount: number;
    projectBackedCount: number;
    emptyOwnerCount: number;
    sdkAndRecognizedCount: number;
    sdkAndShapeReadyCount: number;
    emptyOwnerAndRecognizedCount: number;
    countsByShape: Record<string, number>;
    countsByFamily: Record<string, number>;
    countsByRecognitionLayer: Record<string, number>;
    countsBySlotFamily: Record<string, number>;
    countsByOwner: Record<string, number>;
    sampleSdkBacked: CallbackCandidateRecord[];
    sampleEmptyOwner: CallbackCandidateRecord[];
    sampleSdkShapeButUnrecognized: CallbackCandidateRecord[];
    sampleProjectShapeButUnrecognized: CallbackCandidateRecord[];
}

interface DiagnosticReport {
    generatedAt: string;
    datasets: Record<string, DatasetAggregate>;
}

const MAX_SAMPLES_PER_BUCKET = 12;
const CALLBACK_RESOLVE_OPTIONS = {
    maxCandidates: 8,
    enableLocalBacktrace: true,
    maxBacktraceSteps: 5,
    maxVisitedDefs: 16,
};

function ensureDir(dir: string): void {
    fs.mkdirSync(dir, { recursive: true });
}

function isSemanticCaseFile(fileName: string): boolean {
    return /\.(ets|ts)$/.test(fileName) && /_(T|F)\./.test(fileName);
}

function createCaseView(sourceDir: string, caseName: string, outputRoot: string): string {
    return createIsolatedCaseView(sourceDir, caseName, outputRoot);
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

function loadPureEntryManifest(): PureEntryManifest {
    const manifestPath = path.resolve("tests/manifests/entry_model/main_model_pure_entry_taxonomy.json");
    return JSON.parse(fs.readFileSync(manifestPath, "utf8")) as PureEntryManifest;
}

function listCases(sourceDir: string, suite: PureEntrySuiteSpec): string[] {
    const includePatterns = (suite.caseIncludePatterns || []).map(pattern => new RegExp(pattern));
    const excludePatterns = (suite.caseExcludePatterns || []).map(pattern => new RegExp(pattern));
    return fs.readdirSync(sourceDir)
        .filter(file => file.endsWith(".ets"))
        .map(file => path.basename(file, ".ets"))
        .filter(name => /_(T|F)$/.test(name))
        .filter(name => includePatterns.length === 0 || includePatterns.some(pattern => pattern.test(name)))
        .filter(name => !excludePatterns.some(pattern => pattern.test(name)))
        .sort((left, right) => left.localeCompare(right));
}

function collectDatasetSpecs(): DatasetSpec[] {
    const manifest = loadPureEntryManifest();
    const pureEntryCases = manifest.suites.flatMap(suite => {
        const sourceDir = path.resolve(suite.sourceDir);
        return listCases(sourceDir, suite).map(caseName => ({
            caseName,
            sourceDir,
        }));
    });
    const realworldDir = path.resolve("tests/demo/pure_entry_realworld");
    const realworldCases = fs.existsSync(realworldDir)
        ? fs.readdirSync(realworldDir)
            .filter(file => file.endsWith(".ets"))
            .map(file => path.basename(file, ".ets"))
            .filter(name => /_(T|F)$/.test(name))
            .sort((left, right) => left.localeCompare(right))
            .map(caseName => ({
                caseName,
                sourceDir: realworldDir,
            }))
        : [];
    const sdkProbeDir = path.resolve("tests/demo/sdk_callback_provenance_probe");
    const sdkProbeCases = fs.existsSync(sdkProbeDir)
        ? fs.readdirSync(sdkProbeDir)
            .filter(file => file.endsWith(".ets"))
            .map(file => path.basename(file, ".ets"))
            .filter(name => /_(T|F)$/.test(name))
            .sort((left, right) => left.localeCompare(right))
            .map(caseName => ({
                caseName,
                sourceDir: sdkProbeDir,
            }))
        : [];

    return [
        {
            id: "pure_entry_benchmark",
            caseViews: pureEntryCases,
        },
        {
            id: "pure_entry_realworld",
            caseViews: realworldCases,
        },
        {
            id: "sdk_callback_probe",
            caseViews: sdkProbeCases,
        },
    ];
}

function looksLikeStringArg(value: any): boolean {
    if (!value) return false;
    const typeText = String(value.getType?.()?.toString?.() || "").toLowerCase();
    if (typeText.includes("string")) {
        return true;
    }
    const text = String(value.toString?.() || "").trim();
    return /^['"`].+['"`]$/.test(text);
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

function findOptionsFieldProbes(scene: Scene, explicitArgs: any[]): OptionsFieldProbe[] {
    const probes: OptionsFieldProbe[] = [];
    explicitArgs.forEach((arg, argIndex) => {
        const classSignature = arg?.getType?.()?.getClassSignature?.();
        if (!classSignature) return;
        const klass = scene.getClass(classSignature);
        if (!klass) return;
        const fieldNames = klass.getFields()
            .filter(field => !!((field.getType?.() as any)?.getMethodSignature?.()))
            .map(field => field.getName?.() || "")
            .filter(Boolean)
            .sort((left, right) => left.localeCompare(right));
        if (fieldNames.length === 0) return;
        probes.push({ argIndex, fieldNames });
    });
    return probes;
}

function classifyShape(
    callableArgIndexes: number[],
    stringArgIndexes: number[],
    optionsFieldProbes: OptionsFieldProbe[],
): string {
    if (optionsFieldProbes.length > 0) {
        return "options_object_slot";
    }
    if (callableArgIndexes.length === 0) {
        return "non_callback_candidate";
    }
    if (callableArgIndexes.length > 1) {
        return "multi_callback_slot";
    }
    const callbackIndex = callableArgIndexes[0];
    if (callbackIndex === 0) {
        return "direct_callback_slot";
    }
    if (callbackIndex === 1 && stringArgIndexes.includes(0)) {
        return "string_plus_callback_slot";
    }
    return "trailing_callback_slot";
}

function recordCounter(map: Record<string, number>, key: string): void {
    map[key] = (map[key] || 0) + 1;
}

function pushSample(bucket: CallbackCandidateRecord[], record: CallbackCandidateRecord): void {
    if (bucket.length >= MAX_SAMPLES_PER_BUCKET) return;
    bucket.push(record);
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

interface RecognizedCallbackTag {
    family: string;
    layer?: string;
    shape?: string;
    slotFamily?: string;
}

function pushRecognizedTag(
    out: RecognizedCallbackTag[],
    family: string,
    match: { recognitionLayer?: string; registrationShape?: string; slotFamily?: string } | null | undefined,
): void {
    if (!match) return;
    out.push({
        family,
        layer: match.recognitionLayer,
        shape: match.registrationShape,
        slotFamily: match.slotFamily,
    });
}

function collectRecognizedTags(scene: Scene, sourceMethod: any, stmt: any): RecognizedCallbackTag[] {
    const invokeExpr = stmt?.getInvokeExpr?.();
    if (!invokeExpr) return [];
    const explicitArgs = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
    const matcherArgs = {
        invokeExpr,
        explicitArgs,
        scene,
        sourceMethod,
    };
    const tags: RecognizedCallbackTag[] = [];
    pushRecognizedTag(tags, "framework_callback", resolveKnownFrameworkCallbackRegistration(matcherArgs));
    pushRecognizedTag(tags, "channel_callback", resolveKnownChannelCallbackRegistration(matcherArgs));
    pushRecognizedTag(tags, "scheduler_callback", resolveKnownSchedulerCallbackRegistration(matcherArgs));
    for (const registration of resolveKnownControllerOptionCallbackRegistrationsFromStmt(stmt, scene, sourceMethod)) {
        pushRecognizedTag(tags, "controller_option_callback", registration);
    }
    for (const registration of resolveKnownKeyedCallbackRegistrationsFromStmt(stmt, scene, sourceMethod)) {
        pushRecognizedTag(tags, "keyed_dispatch_callback", registration);
    }
    return tags;
}

function analyzeCase(datasetId: string, caseName: string, sourceDir: string, projectDir: string, scene: Scene): CallbackCandidateRecord[] {
    const records: CallbackCandidateRecord[] = [];
    for (const method of scene.getMethods()) {
        const cfg = method.getCfg?.();
        if (!cfg) continue;
        for (const stmt of cfg.getStmts()) {
            const invokeExpr = stmt?.getInvokeExpr?.();
            if (!invokeExpr) continue;
            const explicitArgs = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
            const callableArgIndexes = findCallableArgIndexes(scene, explicitArgs);
            const optionsFieldProbes = findOptionsFieldProbes(scene, explicitArgs);
            if (callableArgIndexes.length === 0 && optionsFieldProbes.length === 0) {
                continue;
            }

            const recognizedTags = collectRecognizedTags(scene, method, stmt);
            const methodSig = invokeExpr.getMethodSignature?.();
            const classSig = methodSig?.getDeclaringClassSignature?.();
            const fileSig = classSig?.getDeclaringFileSignature?.();
            const registrationOwnerName = classSig?.getClassName?.() || "";
            const stringArgIndexes = explicitArgs
                .map((arg, index) => (looksLikeStringArg(arg) ? index : -1))
                .filter(index => index >= 0);

            records.push({
                datasetId,
                caseName,
                sourceDir,
                sourceMethodSignature: method.getSignature?.()?.toString?.() || "",
                sourceMethodName: method.getName?.() || "",
                registrationSignature: methodSig?.toString?.() || "",
                registrationMethodName: methodSig?.getMethodSubSignature?.()?.getMethodName?.() || "",
                registrationOwnerName,
                registrationClassText: classSig?.toString?.() || "",
                registrationFileText: fileSig?.toString?.() || "",
                registrationProjectName: fileSig?.getProjectName?.() || "",
                registrationNamespaceText: classSig?.getDeclaringNamespaceSignature?.()?.toString?.() || "",
                hasSdkFile: fileSig ? scene.hasSdkFile(fileSig) : false,
                ownerEmpty: registrationOwnerName.length === 0,
                shape: classifyShape(callableArgIndexes, stringArgIndexes, optionsFieldProbes),
                callableArgIndexes,
                stringArgIndexes,
                optionsFieldProbes,
                recognizedFamilies: recognizedTags.map(tag => tag.family),
                recognizedLayers: recognizedTags.map(tag => tag.layer || "").filter(Boolean),
                recognizedShapes: recognizedTags.map(tag => tag.shape || "").filter(Boolean),
                recognizedSlotFamilies: recognizedTags.map(tag => tag.slotFamily || "").filter(Boolean),
            });
        }
    }
    return records;
}

function createEmptyAggregate(caseCount: number): DatasetAggregate {
    return {
        caseCount,
        sdkImportCaseCount: 0,
        candidateCount: 0,
        recognizedCount: 0,
        sdkBackedCount: 0,
        projectBackedCount: 0,
        emptyOwnerCount: 0,
        sdkAndRecognizedCount: 0,
        sdkAndShapeReadyCount: 0,
        emptyOwnerAndRecognizedCount: 0,
        countsByShape: {},
        countsByFamily: {},
        countsByRecognitionLayer: {},
        countsBySlotFamily: {},
        countsByOwner: {},
        sampleSdkBacked: [],
        sampleEmptyOwner: [],
        sampleSdkShapeButUnrecognized: [],
        sampleProjectShapeButUnrecognized: [],
    };
}

function aggregateDataset(datasetId: string, caseViews: Array<{ caseName: string; sourceDir: string }>, outputRoot: string): DatasetAggregate {
    const aggregate = createEmptyAggregate(caseViews.length);
    for (const { caseName, sourceDir } of caseViews) {
        const projectDir = createCaseView(sourceDir, caseName, path.join(outputRoot, datasetId));
        if (hasSdkLikeImports(projectDir)) {
            aggregate.sdkImportCaseCount++;
        }
        const scene = buildScene(projectDir);
        const records = analyzeCase(datasetId, caseName, sourceDir, projectDir, scene);
        for (const record of records) {
            aggregate.candidateCount++;
            recordCounter(aggregate.countsByShape, record.shape);
            recordCounter(aggregate.countsByOwner, record.registrationOwnerName || "@empty");

            if (record.hasSdkFile) {
                aggregate.sdkBackedCount++;
                pushSample(aggregate.sampleSdkBacked, record);
            } else {
                aggregate.projectBackedCount++;
            }
            if (record.ownerEmpty) {
                aggregate.emptyOwnerCount++;
                pushSample(aggregate.sampleEmptyOwner, record);
            }
            if (record.hasSdkFile && record.shape !== "non_callback_candidate") {
                aggregate.sdkAndShapeReadyCount++;
            }

            if (record.recognizedFamilies.length > 0) {
                aggregate.recognizedCount++;
                for (const family of record.recognizedFamilies) {
                    recordCounter(aggregate.countsByFamily, family);
                }
                for (const layer of record.recognizedLayers) {
                    recordCounter(aggregate.countsByRecognitionLayer, layer);
                }
                for (const slotFamily of record.recognizedSlotFamilies) {
                    recordCounter(aggregate.countsBySlotFamily, slotFamily);
                }
                if (record.hasSdkFile) {
                    aggregate.sdkAndRecognizedCount++;
                }
                if (record.ownerEmpty) {
                    aggregate.emptyOwnerAndRecognizedCount++;
                }
            } else if (record.shape !== "non_callback_candidate") {
                if (record.hasSdkFile) {
                    pushSample(aggregate.sampleSdkShapeButUnrecognized, record);
                } else {
                    pushSample(aggregate.sampleProjectShapeButUnrecognized, record);
                }
            }
        }
    }
    return aggregate;
}

function main(): void {
    const outputRoot = path.resolve("tmp/test_runs/entry_model/callback_provenance_diagnostic/latest");
    ensureDir(outputRoot);

    const datasets = collectDatasetSpecs();
    const report: DiagnosticReport = {
        generatedAt: new Date().toISOString(),
        datasets: {},
    };

    for (const dataset of datasets) {
        report.datasets[dataset.id] = aggregateDataset(dataset.id, dataset.caseViews, outputRoot);
    }

    const pureBenchmark = report.datasets["pure_entry_benchmark"];
    const pureRealworld = report.datasets["pure_entry_realworld"];
    const sdkProbe = report.datasets["sdk_callback_probe"];
    if ((pureBenchmark?.sdkBackedCount ?? 0) === 0 && (pureRealworld?.sdkBackedCount ?? 0) === 0) {
        throw new Error("Mock SDK registration failed: pure-entry datasets should contain sdkBacked callback registrations after taint_mock SDK registration.");
    }
    if ((sdkProbe?.sdkBackedCount || 0) === 0 || (sdkProbe?.sdkAndRecognizedCount || 0) === 0) {
        throw new Error("SDK provenance probe failed to produce recognized sdkBacked callback registrations.");
    }
    const allowedSlotFamilies = new Set([
        "ui_direct_slot",
        "gesture_direct_slot",
        "system_direct_slot",
        "subscription_event_slot",
        "completion_callback_slot",
        "controller_option_slot",
        "keyed_dispatch_slot",
        "scheduler_slot",
    ]);
    for (const [datasetId, aggregate] of Object.entries(report.datasets)) {
        for (const slotFamily of Object.keys(aggregate.countsBySlotFamily)) {
            if (!allowedSlotFamilies.has(slotFamily)) {
                throw new Error(`Callback provenance diagnostic found unexpected slot family "${slotFamily}" in dataset ${datasetId}.`);
            }
        }
    }

    const reportPath = path.join(outputRoot, "callback_provenance_report.json");
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`Callback provenance report written to ${reportPath}`);
    for (const [datasetId, aggregate] of Object.entries(report.datasets)) {
        console.log(
            `${datasetId}: cases=${aggregate.caseCount}, sdkImportCases=${aggregate.sdkImportCaseCount}, `
            + `candidates=${aggregate.candidateCount}, recognized=${aggregate.recognizedCount}, `
            + `sdkBacked=${aggregate.sdkBackedCount}, emptyOwner=${aggregate.emptyOwnerCount}`,
        );
    }
}

main();

