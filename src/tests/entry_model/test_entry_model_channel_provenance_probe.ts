import * as fs from "fs";
import * as path from "path";
import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../../arkanalyzer/out/src/Config";
import {
    classifyArkMainChannelInvocationCandidate,
    resolveArkMainChannelInvocationCandidate,
} from "../../core/entry/arkmain/facts/ArkMainChannelInvocationResolver";
import { registerMockSdkFiles } from "../helpers/TestSceneBuilder";

interface ChannelProbeRecord {
    sourceMethodSignature: string;
    sourceMethodName: string;
    invocationSignature: string;
    invocationMethodName: string;
    ownerName: string;
    classText: string;
    fileText: string;
    projectName: string;
    namespaceText: string;
    hasSdkFile: boolean;
    candidateLayer?: string;
    candidateShape?: string;
    classified: boolean;
    classifiedKind?: string;
    classifiedFamily?: string;
}

interface ChannelProbeReport {
    generatedAt: string;
    sourceDir: string;
    sdkDeclarationPresence: {
        ohosRouter: boolean;
        systemRouter: boolean;
    };
    totalInterestingInvocations: number;
    sdkBackedInvocations: number;
    sdkCandidates: number;
    sdkClassified: number;
    uncataloguedSdkCandidates: number;
    routerStatus: string;
    records: ChannelProbeRecord[];
}

function isSdkChannelCandidateLayer(layer: string | undefined): boolean {
    return layer === "sdk_provenance_first_layer" || layer === "sdk_import_provenance_first_layer";
}

const INTERESTING_METHOD_NAMES = new Set([
    "getParams",
    "pushUrl",
    "replaceUrl",
    "pushNamedRoute",
]);

function ensureDir(dir: string): void {
    fs.mkdirSync(dir, { recursive: true });
}

function sdkDeclarationExists(moduleName: string): boolean {
    const sdkRoot = path.resolve("arkanalyzer/tests/resources/Sdk");
    if (!fs.existsSync(sdkRoot)) {
        return false;
    }
    const needle = moduleName.toLowerCase();
    const stack = [sdkRoot];
    while (stack.length > 0) {
        const current = stack.pop()!;
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            const fullPath = path.join(current, entry.name);
            if (entry.isDirectory()) {
                stack.push(fullPath);
                continue;
            }
            if (!entry.isFile()) continue;
            if (!entry.name.endsWith(".d.ts")) continue;
            if (fullPath.toLowerCase().includes(needle)) {
                return true;
            }
        }
    }
    return false;
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

function analyze(scene: Scene): ChannelProbeRecord[] {
    const records: ChannelProbeRecord[] = [];
    for (const method of scene.getMethods()) {
        const cfg = method.getCfg?.();
        if (!cfg) continue;
        for (const stmt of cfg.getStmts()) {
            const invokeExpr = stmt?.getInvokeExpr?.();
            if (!invokeExpr) continue;
            const methodSig = invokeExpr.getMethodSignature?.();
            const methodName = methodSig?.getMethodSubSignature?.()?.getMethodName?.() || "";
            if (!INTERESTING_METHOD_NAMES.has(methodName)) {
                continue;
            }

            const classSig = methodSig?.getDeclaringClassSignature?.();
            const fileSig = classSig?.getDeclaringFileSignature?.();
            const hasSdkFile = !!fileSig && scene.hasSdkFile(fileSig);
            const candidate = resolveArkMainChannelInvocationCandidate(scene, method, invokeExpr);
            const classified = candidate ? classifyArkMainChannelInvocationCandidate(candidate) : null;

            records.push({
                sourceMethodSignature: method.getSignature?.()?.toString?.() || "",
                sourceMethodName: method.getName?.() || "",
                invocationSignature: methodSig?.toString?.() || "",
                invocationMethodName: methodName,
                ownerName: classSig?.getClassName?.() || "",
                classText: classSig?.toString?.() || "",
                fileText: fileSig?.toString?.() || "",
                projectName: fileSig?.getProjectName?.() || "",
                namespaceText: classSig?.getDeclaringNamespaceSignature?.()?.toString?.() || "",
                hasSdkFile,
                candidateLayer: candidate?.recognitionLayer,
                candidateShape: candidate?.discoveryShape,
                classified: !!classified,
                classifiedKind: classified?.factKind,
                classifiedFamily: classified?.entryFamily,
            });
        }
    }
    return records;
}

function computeStatus(
    records: ChannelProbeRecord[],
    scope: (record: ChannelProbeRecord) => boolean,
    classifiedFamilies: string[],
): string {
    const scoped = records.filter(scope);
    if (scoped.length === 0) {
        return "no_probe_invocations";
    }
    const provenanceScoped = scoped.filter(record => isSdkChannelCandidateLayer(record.candidateLayer));
    const sdkScoped = scoped.filter(record => record.hasSdkFile);
    const classified = provenanceScoped.filter(record =>
        isSdkChannelCandidateLayer(record.candidateLayer)
        && record.classified
        && (!!record.classifiedFamily && classifiedFamilies.includes(record.classifiedFamily)),
    );
    if (classified.length > 0) {
        return classified.some(record => record.candidateLayer === "sdk_import_provenance_first_layer")
            ? "sdk_import_provenance_classified"
            : "sdk_provenance_classified";
    }
    if (sdkScoped.length === 0 && provenanceScoped.length === 0) {
        return "blocked_by_sdk_declaration_coverage";
    }
    if (provenanceScoped.length > 0) {
        return provenanceScoped.some(record => record.candidateLayer === "sdk_import_provenance_first_layer")
            ? "sdk_import_provenance_candidate_only"
            : "sdk_provenance_candidate_only";
    }
    return "sdk_visible_but_not_candidate";
}

function main(): void {
    const sourceDir = path.resolve("tests/demo/sdk_channel_provenance_probe");
    const outputDir = path.resolve("tmp/test_runs/entry_model/channel_provenance_probe/latest");
    ensureDir(outputDir);

    const scene = buildScene(sourceDir);
    const records = analyze(scene);
    if (records.length === 0) {
        throw new Error("Channel provenance probe found no interesting invocations.");
    }

    const sdkBackedInvocations = records.filter(record => record.hasSdkFile).length;
    const sdkCandidates = records.filter(record => isSdkChannelCandidateLayer(record.candidateLayer)).length;
    const sdkClassified = records.filter(record =>
        isSdkChannelCandidateLayer(record.candidateLayer) && record.classified,
    ).length;
    const uncataloguedSdkCandidates = records.filter(record =>
        isSdkChannelCandidateLayer(record.candidateLayer) && !record.classified,
    ).length;

    if (sdkCandidates === 0) {
        throw new Error("Channel provenance probe found no sdk-first-layer candidates.");
    }

    const report: ChannelProbeReport = {
        generatedAt: new Date().toISOString(),
        sourceDir,
        sdkDeclarationPresence: {
            ohosRouter: sdkDeclarationExists("@ohos.router"),
            systemRouter: sdkDeclarationExists("@system.router"),
        },
        totalInterestingInvocations: records.length,
        sdkBackedInvocations,
        sdkCandidates,
        sdkClassified,
        uncataloguedSdkCandidates,
        routerStatus: computeStatus(
            records,
            record => record.invocationMethodName === "getParams" || record.invocationMethodName === "pushUrl",
            ["navigation_source", "navigation_trigger"],
        ),
        records,
    };
    if (report.routerStatus !== "sdk_import_provenance_classified") {
        throw new Error(`Expected router probe to reach sdk_import_provenance_classified, got ${report.routerStatus}`);
    }
    if (report.sdkBackedInvocations !== 0) {
        throw new Error(`Expected current pure-entry channel probe to rely on sdk import provenance only, got sdkBacked=${report.sdkBackedInvocations}`);
    }

    const outputPath = path.join(outputDir, "channel_provenance_probe_report.json");
    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), "utf8");

    console.log(`Channel provenance probe report written to ${outputPath}`);
    console.log(
        `interesting=${report.totalInterestingInvocations}, sdk_backed=${report.sdkBackedInvocations}, `
        + `sdk_candidates=${report.sdkCandidates}, sdk_classified=${report.sdkClassified}, `
        + `uncatalogued_sdk_candidates=${report.uncataloguedSdkCandidates}`,
    );
    console.log(
        `router_declarations: @ohos.router=${report.sdkDeclarationPresence.ohosRouter}, `
        + `@system.router=${report.sdkDeclarationPresence.systemRouter}`,
    );
    console.log(`router_status=${report.routerStatus}`);
}

main();

