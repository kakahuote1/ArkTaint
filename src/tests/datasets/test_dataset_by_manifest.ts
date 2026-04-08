import { Scene } from "../../../arkanalyzer/lib/Scene";
import { SceneConfig } from "../../../arkanalyzer/lib/Config";
import * as fs from "fs";
import * as path from "path";
import {
    buildEngineForCase,
    collectCaseSeedNodes,
    findCaseMethod,
    resolveCaseMethod,
} from "../helpers/SyntheticCaseHarness";

interface CategoryStats {
    total: number;
    passed: number;
    failed: number;
    failedCases: string[];
}

interface RuntimeStats {
    listed: number;
    skippedNoEntry: number;
    skippedNoBody: number;
    skippedNoSeed: number;
    skippedException: number;
}

interface CliOptions {
    manifestPath: string;
    kList: number[];
    targetDir: string;
}

function parseKList(raw: string | undefined): number[] {
    const value = (raw || "1").trim().toLowerCase();
    if (value === "both") return [0, 1];
    if (value === "0") return [0];
    if (value === "1") return [1];
    throw new Error(`Invalid --k value: ${raw}. Expected 0, 1, or both.`);
}

function parseArgs(argv: string[]): CliOptions {
    let manifestPath = "";
    let kRaw: string | undefined;
    let targetDir = "d:/cursor/workplace/ArkTaint/tests/demo/senior_full";

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
        if (arg === "--k" && i + 1 < argv.length) {
            kRaw = argv[++i];
            continue;
        }
        if (arg.startsWith("--k=")) {
            kRaw = arg.slice("--k=".length);
            continue;
        }
        if (arg === "--targetDir" && i + 1 < argv.length) {
            targetDir = argv[++i];
            continue;
        }
        if (arg.startsWith("--targetDir=")) {
            targetDir = arg.slice("--targetDir=".length);
            continue;
        }
    }

    if (!manifestPath) {
        throw new Error("Missing required argument: --manifest <path>");
    }

    return {
        manifestPath,
        kList: parseKList(kRaw),
        targetDir,
    };
}

function readManifestCases(manifestPath: string, targetDir: string): string[] {
    const manifestAbs = path.isAbsolute(manifestPath) ? manifestPath : path.resolve(manifestPath);
    if (!fs.existsSync(manifestAbs)) {
        throw new Error(`Manifest file not found: ${manifestAbs}`);
    }

    const lines = fs.readFileSync(manifestAbs, "utf-8").split(/\r?\n/);
    const dedup = new Set<string>();
    const cases: string[] = [];

    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#")) continue;

        const relativePath = line.replace(/\\/g, "/");
        const normalized = path.normalize(relativePath);
        const absPath = path.resolve(targetDir, normalized);
        if (!fs.existsSync(absPath)) {
            console.warn(`[WARN] manifest entry not found: ${relativePath}`);
            continue;
        }

        const key = path.resolve(absPath).toLowerCase();
        if (dedup.has(key)) continue;
        dedup.add(key);
        cases.push(absPath);
    }

    return cases.sort((a, b) => a.localeCompare(b));
}

async function runWithK(
    scene: Scene,
    files: string[],
    targetDir: string,
    k: number
): Promise<{ stats: Record<string, CategoryStats>; runtime: RuntimeStats }> {
    const stats: Record<string, CategoryStats> = {};
    const runtime: RuntimeStats = {
        listed: files.length,
        skippedNoEntry: 0,
        skippedNoBody: 0,
        skippedNoSeed: 0,
        skippedException: 0,
    };

    for (const file of files) {
        if (file.endsWith("taint_mock.ts") || file.endsWith("package.json")) continue;

        const relativePath = path.relative(targetDir, file);
        const category = path.dirname(relativePath).split(path.sep)[0];
        if (!stats[category]) {
            stats[category] = { total: 0, passed: 0, failed: 0, failedCases: [] };
        }

        const testName = path.basename(file, ".ets");
        const entry = resolveCaseMethod(scene, relativePath, testName);
        const expected = testName.endsWith("_T") || testName.includes("_T_");

        try {
            const entryMethod = findCaseMethod(scene, entry);
            if (!entryMethod) {
                runtime.skippedNoEntry++;
                stats[category].failed++;
                stats[category].failedCases.push(`${testName} (reason:no_entry)`);
                stats[category].total++;
                continue;
            }

            const methodBody = entryMethod.getBody();
            if (!methodBody) {
                runtime.skippedNoBody++;
                stats[category].failed++;
                stats[category].failedCases.push(`${testName} (reason:no_body)`);
                stats[category].total++;
                continue;
            }

            const engine = await buildEngineForCase(scene, k, entryMethod, {
                verbose: false,
            });
            const seeds = collectCaseSeedNodes(engine, entryMethod);

            if (seeds.length === 0) {
                runtime.skippedNoSeed++;
                stats[category].failed++;
                stats[category].failedCases.push(`${testName} (reason:no_seed)`);
                stats[category].total++;
                continue;
            }

            engine.propagateWithSeeds(seeds);
            const flows = engine.detectSinks("Sink");
            const detected = flows.length > 0;

            if (detected === expected) {
                stats[category].passed++;
            } else {
                stats[category].failed++;
                stats[category].failedCases.push(`${testName} (Exp:${expected ? "T" : "F"} Got:${detected ? "T" : "F"})`);
            }
            stats[category].total++;
        } catch (err) {
            runtime.skippedException++;
            console.warn(`[WARN] skipped by exception: ${relativePath}`);
            stats[category].failed++;
            stats[category].failedCases.push(`${testName} (reason:exception)`);
            stats[category].total++;
        }
    }

    return { stats, runtime };
}

function printResults(stats: Record<string, CategoryStats>, label: string): { total: number; passed: number; failed: number } {
    console.log(`\n====== ${label} ======`);
    let grandTotal = 0;
    let grandPassed = 0;
    let grandFailed = 0;
    const cats = Object.keys(stats).sort();
    for (const cat of cats) {
        const s = stats[cat];
        const rate = s.total > 0 ? ((s.passed / s.total) * 100).toFixed(1) : "0.0";
        console.log(
            `  ${cat.padEnd(25)} | Total: ${s.total.toString().padEnd(3)} | Passed: ${s.passed.toString().padEnd(3)} | Failed: ${s.failed
                .toString()
                .padEnd(3)} | Rate: ${rate}%`
        );
        grandTotal += s.total;
        grandPassed += s.passed;
        grandFailed += s.failed;
    }
    const overallRate = grandTotal > 0 ? ((grandPassed / grandTotal) * 100).toFixed(1) : "0.0";
    console.log(
        `  ${"TOTAL".padEnd(25)} | Total: ${grandTotal.toString().padEnd(3)} | Passed: ${grandPassed.toString().padEnd(3)} | Failed: ${grandFailed
            .toString()
            .padEnd(3)} | Rate: ${overallRate}%`
    );
    return { total: grandTotal, passed: grandPassed, failed: grandFailed };
}

function printRuntime(runtime: RuntimeStats): void {
    console.log("------ Runtime ------");
    console.log(`  listed cases: ${runtime.listed}`);
    console.log(`  skipped(no entry): ${runtime.skippedNoEntry}`);
    console.log(`  skipped(no body): ${runtime.skippedNoBody}`);
    console.log(`  skipped(no seed): ${runtime.skippedNoSeed}`);
    console.log(`  skipped(exception): ${runtime.skippedException}`);
}

async function main(): Promise<void> {
    const options = parseArgs(process.argv.slice(2));
    const targetDir = path.resolve(options.targetDir);
    if (!fs.existsSync(targetDir)) {
        throw new Error(`Target directory not found: ${targetDir}`);
    }

    const manifestCases = readManifestCases(options.manifestPath, targetDir);
    console.log(`manifest=${options.manifestPath}`);
    console.log(`targetDir=${targetDir}`);
    console.log(`listed test files=${manifestCases.length}`);

    const config = new SceneConfig();
    config.buildFromProjectDir(targetDir);
    const scene = new Scene();
    scene.buildSceneFromProjectDir(config);
    scene.inferTypes();

    let hasFailure = false;
    for (const k of options.kList) {
        console.log(`\n>>> Running with k=${k}`);
        const { stats, runtime } = await runWithK(scene, manifestCases, targetDir, k);
        const summary = printResults(stats, `manifest results (k=${k})`);
        printRuntime(runtime);
        if (summary.failed > 0) hasFailure = true;
    }

    if (hasFailure) {
        process.exitCode = 1;
    }
}

main().catch(err => {
    console.error(err);
    process.exitCode = 1;
});

