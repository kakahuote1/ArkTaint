import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../../arkanalyzer/out/src/Config";
import { TaintPropagationEngine } from "../../core/TaintPropagationEngine";
import { ArkAssignStmt } from "../../../arkanalyzer/out/src/core/base/Stmt";
import { ArkParameterRef } from "../../../arkanalyzer/out/src/core/base/Ref";
import { Local } from "../../../arkanalyzer/out/src/core/base/Local";
import * as fs from "fs";
import * as path from "path";

export interface CliOptions {
    manifestPath: string;
    k: number;
    sourceDir: string;
    tempProjectDir: string;
    reportPath: string;
}

interface SeedCase {
    relativePath: string;
}

interface VariantCase {
    sourceRelativePath: string;
    mutatedRelativePath: string;
    transform: string;
    category: string;
    expected: boolean;
}

interface AnalyzeResult {
    ok: boolean;
    detected: boolean;
    expected: boolean;
    skipReason?: string;
    error?: string;
}

interface PairResult {
    caseId: string;
    category: string;
    transform: string;
    sourceRelativePath: string;
    mutatedRelativePath: string;
    sourceDetected: boolean;
    mutatedDetected: boolean;
    expected: boolean;
    consistent: boolean;
}

interface SummaryByCategory {
    total: number;
    consistent: number;
    inconsistent: number;
}

interface Report {
    generatedAt: string;
    options: CliOptions;
    seedCaseCount: number;
    variantCaseCount: number;
    pairCount: number;
    consistentCount: number;
    inconsistentCount: number;
    sourceAnalyzeFailures: number;
    mutatedAnalyzeFailures: number;
    sourceBaselineMismatchCount: number;
    byCategory: Record<string, SummaryByCategory>;
    inconsistentPairs: PairResult[];
}

interface ResolvedEntry {
    name: string;
    pathHint?: string;
}

export interface TransformOutput {
    code: string;
    changed?: boolean;
}

export interface TransformSpec {
    name: string;
    apply: (sourceCode: string) => TransformOutput;
}

export interface MetamorphicSuiteConfig {
    defaults: CliOptions;
    transforms: TransformSpec[];
    variantTag?: string;
    skipUnchangedVariants?: boolean;
}

function parseArgs(argv: string[], defaults: CliOptions): CliOptions {
    let manifestPath = defaults.manifestPath;
    let sourceDir = defaults.sourceDir;
    let tempProjectDir = defaults.tempProjectDir;
    let reportPath = defaults.reportPath;
    let k = defaults.k;

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--manifest" && i + 1 < argv.length) {
            manifestPath = argv[++i];
            continue;
        }
        if (arg.startsWith("--manifest=")) {
            manifestPath = arg.slice("--manifest=".length);
            continue;
        }
        if (arg === "--sourceDir" && i + 1 < argv.length) {
            sourceDir = argv[++i];
            continue;
        }
        if (arg.startsWith("--sourceDir=")) {
            sourceDir = arg.slice("--sourceDir=".length);
            continue;
        }
        if (arg === "--tmpDir" && i + 1 < argv.length) {
            tempProjectDir = argv[++i];
            continue;
        }
        if (arg.startsWith("--tmpDir=")) {
            tempProjectDir = arg.slice("--tmpDir=".length);
            continue;
        }
        if (arg === "--report" && i + 1 < argv.length) {
            reportPath = argv[++i];
            continue;
        }
        if (arg.startsWith("--report=")) {
            reportPath = arg.slice("--report=".length);
            continue;
        }
        if (arg === "--k" && i + 1 < argv.length) {
            k = Number(argv[++i]);
            continue;
        }
        if (arg.startsWith("--k=")) {
            k = Number(arg.slice("--k=".length));
            continue;
        }
    }

    if (k !== 0 && k !== 1) {
        throw new Error(`Invalid --k value: ${k}. Expected 0 or 1.`);
    }

    return {
        manifestPath,
        sourceDir,
        tempProjectDir,
        reportPath,
        k,
    };
}

function readSeedCases(manifestPath: string): SeedCase[] {
    const manifestAbs = path.isAbsolute(manifestPath) ? manifestPath : path.resolve(manifestPath);
    if (!fs.existsSync(manifestAbs)) {
        throw new Error(`Manifest file not found: ${manifestAbs}`);
    }

    const lines = fs.readFileSync(manifestAbs, "utf-8").split(/\r?\n/);
    const out: SeedCase[] = [];
    const dedup = new Set<string>();
    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#")) continue;
        const normalized = line.replace(/\\/g, "/");
        if (dedup.has(normalized)) continue;
        dedup.add(normalized);
        out.push({ relativePath: normalized });
    }
    return out;
}

function ensureDir(dir: string): void {
    fs.mkdirSync(dir, { recursive: true });
}

function resetDir(dir: string): void {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
}

function generateVariants(
    options: CliOptions,
    seedCases: SeedCase[],
    transforms: TransformSpec[],
    variantTag: string,
    skipUnchangedVariants: boolean
): VariantCase[] {
    const variants: VariantCase[] = [];
    resetDir(options.tempProjectDir);

    for (const seed of seedCases) {
        const sourceAbs = path.resolve(options.sourceDir, seed.relativePath);
        if (!fs.existsSync(sourceAbs)) {
            throw new Error(`Seed file not found: ${seed.relativePath}`);
        }

        const sourceDirRel = path.dirname(seed.relativePath).replace(/\\/g, "/");
        const sourceBaseName = path.basename(seed.relativePath, ".ets");
        const category = sourceDirRel.split("/")[0];
        const expected = sourceBaseName.endsWith("_T") || sourceBaseName.includes("_T_");

        const sourceCode = fs.readFileSync(sourceAbs, "utf-8");
        const targetDir = path.join(options.tempProjectDir, sourceDirRel);
        ensureDir(targetDir);

        const taintMockAbs = path.join(path.dirname(sourceAbs), "taint_mock.ts");
        if (fs.existsSync(taintMockAbs)) {
            const taintMockTarget = path.join(targetDir, "taint_mock.ts");
            if (!fs.existsSync(taintMockTarget)) {
                fs.copyFileSync(taintMockAbs, taintMockTarget);
            }
        }

        for (const transform of transforms) {
            const transformed = transform.apply(sourceCode);
            const changed = transformed.changed ?? transformed.code !== sourceCode;
            if (skipUnchangedVariants && !changed) {
                continue;
            }

            const mutatedFileName = `${sourceBaseName}__${variantTag}_${transform.name}.ets`;
            const mutatedRelativePath = path.join(sourceDirRel, mutatedFileName).replace(/\\/g, "/");
            const mutatedAbs = path.join(targetDir, mutatedFileName);
            fs.writeFileSync(mutatedAbs, transformed.code, "utf-8");

            variants.push({
                sourceRelativePath: seed.relativePath,
                mutatedRelativePath,
                transform: transform.name,
                category,
                expected,
            });
        }
    }

    return variants;
}

function getParameterLocalNames(entryMethod: any): Set<string> {
    const names = new Set<string>();
    const cfg = entryMethod.getCfg();
    if (!cfg) return names;

    for (const stmt of cfg.getStmts()) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        if (!(stmt.getRightOp() instanceof ArkParameterRef)) continue;
        const leftOp = stmt.getLeftOp();
        if (leftOp instanceof Local) names.add(leftOp.getName());
    }
    return names;
}

function resolveEntryMethod(scene: Scene, relativePath: string, testName: string): ResolvedEntry {
    const normalized = relativePath.split(path.sep).join("/");
    const isCrossFileA = normalized.includes("completeness/cross_file/") && testName.endsWith("_a");
    if (isCrossFileA) {
        const companion = `${testName.slice(0, -2)}_b`;
        const hasCompanion = scene.getMethods().some(m => m.getName() === companion);
        if (hasCompanion) {
            const companionHint = normalized.replace(/_a\.ets$/i, "_b.ets");
            return { name: companion, pathHint: companionHint };
        }
    }

    const hasSameName = scene.getMethods().some(m => m.getName() === testName);
    if (hasSameName) {
        return { name: testName, pathHint: normalized };
    }

    const methodsInFile = scene
        .getMethods()
        .filter(m => m.getSignature().toString().includes(normalized) && m.getName() !== "%dflt");
    const labeled = methodsInFile.filter(m => /_(T|F)(?:_[ab])?$/.test(m.getName()));

    if (labeled.length === 1) {
        return { name: labeled[0].getName(), pathHint: normalized };
    }

    const expectedLabel = testName.includes("_T") ? "_T" : testName.includes("_F") ? "_F" : "";
    if (expectedLabel) {
        const labelMatch = labeled.find(m => m.getName().includes(expectedLabel));
        if (labelMatch) {
            return { name: labelMatch.getName(), pathHint: normalized };
        }
    }

    if (methodsInFile.length > 0) {
        return { name: methodsInFile[0].getName(), pathHint: normalized };
    }

    return { name: testName, pathHint: normalized };
}

function findEntryMethod(scene: Scene, entry: ResolvedEntry): any | undefined {
    const candidates = scene.getMethods().filter(m => m.getName() === entry.name);
    if (entry.pathHint) {
        const normalizedHint = entry.pathHint.replace(/\\/g, "/");
        const hinted = candidates.find(m => m.getSignature().toString().includes(normalizedHint));
        if (hinted) return hinted;
    }
    return candidates[0];
}

function buildScene(projectDir: string): Scene {
    const config = new SceneConfig();
    config.buildFromProjectDir(projectDir);
    const scene = new Scene();
    scene.buildSceneFromProjectDir(config);
    scene.inferTypes();
    return scene;
}

async function analyzeCase(
    scene: Scene,
    relativePath: string,
    k: number,
    expected: boolean
): Promise<AnalyzeResult> {
    try {
        const testName = path.basename(relativePath, ".ets");
        const entry = resolveEntryMethod(scene, relativePath, testName);

        const engine = new TaintPropagationEngine(scene, k);
        engine.verbose = false;
        await engine.buildPAG(entry.name, entry.pathHint);

        const entryMethod = findEntryMethod(scene, entry);
        if (!entryMethod) {
            return { ok: false, expected, detected: false, skipReason: "no_entry" };
        }

        const methodBody = entryMethod.getBody();
        if (!methodBody) {
            return { ok: false, expected, detected: false, skipReason: "no_body" };
        }

        const paramLocalNames = getParameterLocalNames(entryMethod);
        const seeds: any[] = [];
        for (const local of methodBody.getLocals().values()) {
            if (local.getName() === "taint_src" || local.getName() === "taint_src_meta" || paramLocalNames.has(local.getName())) {
                const nodes = engine.pag.getNodesByValue(local);
                if (!nodes) continue;
                for (const nodeId of nodes.values()) {
                    seeds.push(engine.pag.getNode(nodeId));
                }
            }
        }

        if (seeds.length === 0) {
            return { ok: false, expected, detected: false, skipReason: "no_seed" };
        }

        engine.propagateWithSeeds(seeds);
        const flows = engine.detectSinks("Sink");
        const detected = flows.length > 0;
        return { ok: true, detected, expected };
    } catch (err: any) {
        return {
            ok: false,
            expected,
            detected: false,
            skipReason: "exception",
            error: String(err?.message || err),
        };
    }
}

function printCategorySummary(byCategory: Record<string, SummaryByCategory>): void {
    const categories = Object.keys(byCategory).sort();
    for (const category of categories) {
        const s = byCategory[category];
        const rate = s.total > 0 ? ((s.consistent / s.total) * 100).toFixed(1) : "0.0";
        console.log(
            `  ${category.padEnd(25)} | Total: ${String(s.total).padEnd(3)} | Consistent: ${String(s.consistent).padEnd(3)} | Inconsistent: ${String(s.inconsistent).padEnd(3)} | Rate: ${rate}%`
        );
    }
}

export async function runMetamorphicSuite(config: MetamorphicSuiteConfig): Promise<void> {
    const options = parseArgs(process.argv.slice(2), config.defaults);
    const sourceDir = path.resolve(options.sourceDir);
    const tempProjectDir = path.resolve(options.tempProjectDir);
    const reportPath = path.resolve(options.reportPath);
    const variantTag = config.variantTag ?? "m";
    const skipUnchangedVariants = config.skipUnchangedVariants ?? false;

    if (!fs.existsSync(sourceDir)) {
        throw new Error(`Source dataset directory not found: ${sourceDir}`);
    }

    const seedCases = readSeedCases(options.manifestPath);
    const variants = generateVariants(
        { ...options, sourceDir, tempProjectDir, reportPath },
        seedCases,
        config.transforms,
        variantTag,
        skipUnchangedVariants
    );

    console.log(`seed cases=${seedCases.length}`);
    console.log(`generated variants=${variants.length}`);
    console.log(`sourceDir=${sourceDir}`);
    console.log(`tempProjectDir=${tempProjectDir}`);

    const sourceScene = buildScene(sourceDir);
    const mutatedScene = buildScene(tempProjectDir);

    const pairResults: PairResult[] = [];
    let sourceAnalyzeFailures = 0;
    let mutatedAnalyzeFailures = 0;
    let sourceBaselineMismatchCount = 0;

    for (const variant of variants) {
        const sourceResult = await analyzeCase(
            sourceScene,
            variant.sourceRelativePath,
            options.k,
            variant.expected
        );
        const mutatedResult = await analyzeCase(
            mutatedScene,
            variant.mutatedRelativePath,
            options.k,
            variant.expected
        );

        if (!sourceResult.ok) sourceAnalyzeFailures++;
        if (!mutatedResult.ok) mutatedAnalyzeFailures++;

        if (sourceResult.ok && sourceResult.detected !== sourceResult.expected) {
            sourceBaselineMismatchCount++;
        }

        if (!sourceResult.ok || !mutatedResult.ok) {
            continue;
        }

        const consistent = sourceResult.detected === mutatedResult.detected;
        pairResults.push({
            caseId: `${path.basename(variant.sourceRelativePath)}::${variant.transform}`,
            category: variant.category,
            transform: variant.transform,
            sourceRelativePath: variant.sourceRelativePath,
            mutatedRelativePath: variant.mutatedRelativePath,
            sourceDetected: sourceResult.detected,
            mutatedDetected: mutatedResult.detected,
            expected: variant.expected,
            consistent,
        });
    }

    const byCategory: Record<string, SummaryByCategory> = {};
    for (const pair of pairResults) {
        if (!byCategory[pair.category]) {
            byCategory[pair.category] = { total: 0, consistent: 0, inconsistent: 0 };
        }
        byCategory[pair.category].total++;
        if (pair.consistent) byCategory[pair.category].consistent++;
        else byCategory[pair.category].inconsistent++;
    }

    const inconsistentPairs = pairResults.filter(p => !p.consistent);
    const report: Report = {
        generatedAt: new Date().toISOString(),
        options: {
            ...options,
            sourceDir,
            tempProjectDir,
            reportPath,
        },
        seedCaseCount: seedCases.length,
        variantCaseCount: variants.length,
        pairCount: pairResults.length,
        consistentCount: pairResults.length - inconsistentPairs.length,
        inconsistentCount: inconsistentPairs.length,
        sourceAnalyzeFailures,
        mutatedAnalyzeFailures,
        sourceBaselineMismatchCount,
        byCategory,
        inconsistentPairs,
    };

    ensureDir(path.dirname(reportPath));
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf-8");

    console.log("\n====== metamorphic consistency ======");
    console.log(`  pairCount=${report.pairCount}`);
    console.log(`  consistent=${report.consistentCount}`);
    console.log(`  inconsistent=${report.inconsistentCount}`);
    console.log(`  sourceAnalyzeFailures=${report.sourceAnalyzeFailures}`);
    console.log(`  mutatedAnalyzeFailures=${report.mutatedAnalyzeFailures}`);
    console.log(`  sourceBaselineMismatch=${report.sourceBaselineMismatchCount}`);
    console.log(`  report=${reportPath}`);
    console.log("\n------ by category ------");
    printCategorySummary(byCategory);

    if (inconsistentPairs.length > 0) {
        console.log("\n------ inconsistent pairs ------");
        for (const pair of inconsistentPairs) {
            console.log(
                `  - ${pair.caseId}: src=${pair.sourceDetected ? "T" : "F"}, mut=${pair.mutatedDetected ? "T" : "F"}, expected=${pair.expected ? "T" : "F"}`
            );
        }
    }

    if (
        report.inconsistentCount > 0 ||
        report.sourceAnalyzeFailures > 0 ||
        report.mutatedAnalyzeFailures > 0 ||
        report.sourceBaselineMismatchCount > 0
    ) {
        process.exitCode = 1;
    }
}
