import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

interface FileLineInfo {
    file: string;
    lines: number;
}

interface FunctionFingerprint {
    name: string;
    file: string;
    startLine: number;
    lineCount: number;
    hash: string;
}

const ALLOWED_OVERSIZE_FILES = new Set<string>([
    path.normalize("src/core/engine/ConfigBasedTransferExecutor.ts"),
    path.normalize("src/core/engine/SinkDetector.ts"),
    path.normalize("src/core/engine/WorklistSolver.ts"),
    path.normalize("src/cli/analyzeRunner.ts"),
]);

const ALLOWED_DIRECT_PROCESS_TEST_FILES = new Set<string>([
    path.normalize("src/tests/test_analyze_perf_compare_arktan.ts"),
    path.normalize("src/tests/test_analyze_perf_profile.ts"),
    path.normalize("src/tests/test_project_rules_only_workflow.ts"),
    path.normalize("src/tests/test_project_rule_unknown_reduction.ts"),
    path.normalize("src/tests/test_verify_generalization.ts"),
    path.normalize("src/tests/test_structure.ts"),
]);

const ALLOWED_DUPLICATE_LARGE_FUNCTION_GROUPS = new Set<string>([
    "resolveEntryMethod@src\\tests\\metamorphic\\MetamorphicHarness.ts|src\\tests\\test_dataset_by_manifest.ts",
]);

function listTsFiles(rootDir: string): string[] {
    const out: string[] = [];
    const stack = [rootDir];
    while (stack.length > 0) {
        const dir = stack.pop()!;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (entry.name === "node_modules" || entry.name === "out" || entry.name === ".git") continue;
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                stack.push(full);
                continue;
            }
            if (!entry.isFile()) continue;
            if (entry.name.endsWith(".ts")) {
                out.push(full);
            }
        }
    }
    return out;
}

function countLines(file: string): number {
    const text = fs.readFileSync(file, "utf-8");
    if (text.length === 0) return 0;
    return text.split(/\r?\n/).length;
}

function hashText(text: string): string {
    return crypto.createHash("sha1").update(text).digest("hex");
}

function extractFunctionFingerprints(file: string, minLines: number): FunctionFingerprint[] {
    const text = fs.readFileSync(file, "utf-8");
    const lines = text.split(/\r?\n/);
    const out: FunctionFingerprint[] = [];
    let i = 0;
    while (i < lines.length) {
        const line = lines[i];
        const m = line.match(/^\s*function\s+([A-Za-z0-9_]+)\s*\(/);
        if (!m) {
            i++;
            continue;
        }
        const name = m[1];
        const startLine = i + 1;
        const bodyLines: string[] = [];
        let braceDepth = 0;
        let started = false;
        let j = i;
        while (j < lines.length) {
            const current = lines[j];
            bodyLines.push(current);
            for (const ch of current) {
                if (ch === "{") {
                    braceDepth++;
                    started = true;
                } else if (ch === "}") {
                    braceDepth--;
                }
            }
            if (started && braceDepth <= 0) break;
            j++;
        }
        const lineCount = bodyLines.length;
        if (lineCount >= minLines) {
            const normalized = bodyLines
                .map(l => l.trim())
                .filter(l => l.length > 0)
                .join(" ")
                .replace(/\s+/g, " ");
            out.push({
                name,
                file,
                startLine,
                lineCount,
                hash: hashText(normalized),
            });
        }
        i = Math.max(i + 1, j + 1);
    }
    return out;
}

function main(): void {
    const projectRoot = process.cwd();
    const srcDir = path.resolve(projectRoot, "src");
    const testDir = path.resolve(projectRoot, "src", "tests");
    const maxLines = 600;
    const largeFunctionMinLines = 25;

    const allTsFiles = listTsFiles(srcDir);
    const lineInfos: FileLineInfo[] = allTsFiles.map(file => ({
        file,
        lines: countLines(file),
    }));

    const oversize = lineInfos.filter(info => info.lines > maxLines);
    const nearLimit = lineInfos
        .filter(info => info.lines > 500 && info.lines <= maxLines)
        .sort((a, b) => b.lines - a.lines);

    const testTsFiles = listTsFiles(testDir).filter(file => file.endsWith(".ts"));
    const nonHelperTestFiles = testTsFiles.filter(file => !file.includes(`${path.sep}helpers${path.sep}`));

    const directProcessViolations: string[] = [];
    for (const file of nonHelperTestFiles) {
        const text = fs.readFileSync(file, "utf-8");
        if (text.includes("spawnSync(")) {
            const rel = path.normalize(path.relative(projectRoot, file));
            if (!ALLOWED_DIRECT_PROCESS_TEST_FILES.has(rel)) {
                directProcessViolations.push(file);
            }
        }
    }

    const functionFingerprints: FunctionFingerprint[] = [];
    for (const file of nonHelperTestFiles) {
        functionFingerprints.push(...extractFunctionFingerprints(file, largeFunctionMinLines));
    }

    const byHash = new Map<string, FunctionFingerprint[]>();
    for (const fp of functionFingerprints) {
        const arr = byHash.get(fp.hash) || [];
        arr.push(fp);
        byHash.set(fp.hash, arr);
    }
    const duplicateLargeFunctions = [...byHash.values()]
        .filter(group => {
            if (group.length < 2) return false;
            const files = new Set(group.map(x => x.file));
            return files.size >= 2;
        })
        .sort((a, b) => b[0].lineCount - a[0].lineCount);

    const buildDuplicateGroupKey = (group: FunctionFingerprint[]): string => {
        const funcNames = [...new Set(group.map(x => x.name))].sort().join(",");
        const files = [...new Set(group.map(x => path.normalize(path.relative(projectRoot, x.file))))].sort().join("|");
        return `${funcNames}@${files}`;
    };

    const blockedOversize = oversize.filter(info => {
        const rel = path.normalize(path.relative(projectRoot, info.file));
        return !ALLOWED_OVERSIZE_FILES.has(rel);
    });
    const allowedOversize = oversize.filter(info => {
        const rel = path.normalize(path.relative(projectRoot, info.file));
        return ALLOWED_OVERSIZE_FILES.has(rel);
    });

    const blockedDuplicateLargeFunctions = duplicateLargeFunctions.filter(group => {
        const key = buildDuplicateGroupKey(group);
        return !ALLOWED_DUPLICATE_LARGE_FUNCTION_GROUPS.has(key);
    });
    const allowedDuplicateLargeFunctions = duplicateLargeFunctions.filter(group => {
        const key = buildDuplicateGroupKey(group);
        return ALLOWED_DUPLICATE_LARGE_FUNCTION_GROUPS.has(key);
    });

    console.log("====== Structure Gate ======");
    console.log(`scanned_ts_files=${allTsFiles.length}`);
    console.log(`line_limit=${maxLines}`);

    if (nearLimit.length > 0) {
        console.log("near_limit_files:");
        for (const info of nearLimit) {
            console.log(`  ${path.relative(projectRoot, info.file)} lines=${info.lines}`);
        }
    }

    if (blockedOversize.length > 0) {
        console.log("oversize_files:");
        for (const info of blockedOversize) {
            console.log(`  ${path.relative(projectRoot, info.file)} lines=${info.lines}`);
        }
    }
    if (allowedOversize.length > 0) {
        console.log("oversize_files_allowed:");
        for (const info of allowedOversize) {
            console.log(`  ${path.relative(projectRoot, info.file)} lines=${info.lines}`);
        }
    }

    if (directProcessViolations.length > 0) {
        console.log("direct_process_usage_in_tests:");
        for (const file of directProcessViolations) {
            console.log(`  ${path.relative(projectRoot, file)}`);
        }
    }

    if (blockedDuplicateLargeFunctions.length > 0) {
        console.log("duplicate_large_functions:");
        for (const group of blockedDuplicateLargeFunctions) {
            const desc = group
                .map(x => `${path.relative(projectRoot, x.file)}:${x.startLine}(${x.name},lines=${x.lineCount})`)
                .join(" | ");
            console.log(`  ${desc}`);
        }
    }
    if (allowedDuplicateLargeFunctions.length > 0) {
        console.log("duplicate_large_functions_allowed:");
        for (const group of allowedDuplicateLargeFunctions) {
            const desc = group
                .map(x => `${path.relative(projectRoot, x.file)}:${x.startLine}(${x.name},lines=${x.lineCount})`)
                .join(" | ");
            console.log(`  ${desc}`);
        }
    }

    const pass = blockedOversize.length === 0
        && directProcessViolations.length === 0
        && blockedDuplicateLargeFunctions.length === 0;

    console.log(`structure_pass=${pass}`);
    if (!pass) {
        process.exitCode = 1;
    }
}

main();
