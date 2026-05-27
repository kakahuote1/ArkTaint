import * as fs from "fs";
import * as path from "path";
import { execFileSync } from "child_process";

interface ImportRef {
    fromFile: string;
    specifier: string;
    resolvedFile?: string;
}

interface Violation {
    file: string;
    reason: string;
}

const ROOT = process.cwd();
const SOURCE_ROOTS = ["src", "tests", "docs"];
const CORE_ROOT = normalizePath(path.resolve(ROOT, "src/core"));

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

function normalizePath(input: string): string {
    return input.replace(/\\/g, "/");
}

function repoRelative(absPath: string): string {
    return normalizePath(path.relative(ROOT, absPath));
}

function isDirectory(absPath: string): boolean {
    return fs.existsSync(absPath) && fs.statSync(absPath).isDirectory();
}

function collectFiles(absDir: string, predicate: (file: string) => boolean): string[] {
    if (!isDirectory(absDir)) return [];
    const out: string[] = [];
    for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
        const fullPath = path.join(absDir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === "node_modules" || entry.name === "out" || entry.name === ".git") continue;
            out.push(...collectFiles(fullPath, predicate));
            continue;
        }
        if (entry.isFile() && predicate(fullPath)) {
            out.push(fullPath);
        }
    }
    return out;
}

function collectTextFiles(): string[] {
    const exts = new Set([".ts", ".tsx", ".js", ".json", ".md"]);
    return SOURCE_ROOTS.flatMap(root => collectFiles(path.resolve(ROOT, root), file => exts.has(path.extname(file))));
}

function extractImports(fileText: string): string[] {
    const out = new Set<string>();
    const fromPattern = /\b(?:import|export)\s+(?:type\s+)?[\s\S]*?\bfrom\s+["']([^"']+)["']/g;
    const requirePattern = /\brequire\(\s*["']([^"']+)["']\s*\)/g;
    let match: RegExpExecArray | null;
    while ((match = fromPattern.exec(fileText)) !== null) {
        out.add(match[1]);
    }
    while ((match = requirePattern.exec(fileText)) !== null) {
        out.add(match[1]);
    }
    return [...out.values()];
}

function resolveImport(fromFile: string, specifier: string): string | undefined {
    if (!specifier.startsWith(".")) return undefined;
    const base = path.resolve(path.dirname(fromFile), specifier);
    const candidates = [
        base,
        `${base}.ts`,
        `${base}.tsx`,
        `${base}.js`,
        path.join(base, "index.ts"),
        path.join(base, "index.js"),
    ];
    for (const candidate of candidates) {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
            return normalizePath(candidate);
        }
    }
    return undefined;
}

function collectImportRefs(absRoot: string): ImportRef[] {
    return collectFiles(absRoot, file => file.endsWith(".ts") && !file.endsWith(".d.ts")).flatMap(file => {
        const text = fs.readFileSync(file, "utf8");
        return extractImports(text).map(specifier => ({
            fromFile: repoRelative(file),
            specifier,
            resolvedFile: resolveImport(file, specifier),
        }));
    });
}

function requireNoViolations(title: string, violations: Violation[]): void {
    assert(
        violations.length === 0,
        `${title}:\n${violations.map(item => `  ${item.file}: ${item.reason}`).join("\n")}`,
    );
}

function checkImportBoundaries(): void {
    const refs = collectImportRefs(path.resolve(ROOT, "src/core"));
    const violations: Violation[] = [];
    for (const ref of refs) {
        const from = normalizePath(ref.fromFile);
        const targetAbs = ref.resolvedFile ? normalizePath(ref.resolvedFile) : "";
        const target = targetAbs.startsWith(CORE_ROOT) ? repoRelative(targetAbs) : ref.specifier;

        if (from.startsWith("src/core/semanticflow/")) {
            if (
                target.startsWith("src/core/kernel/oclfs/") ||
                target.startsWith("src/core/orchestration/postsolve/") ||
                target.startsWith("src/core/orchestration/TaintPropagationEngine")
            ) {
                violations.push({ file: from, reason: `semanticflow must not import solving/postsolve code: ${target}` });
            }
        }

        if (from.startsWith("src/core/provenance/") && target.startsWith("src/core/orchestration/postsolve/")) {
            violations.push({ file: from, reason: `provenance must not import postsolve: ${target}` });
        }

        if (from.startsWith("src/core/orchestration/postsolve/")) {
            if (target.startsWith("src/core/kernel/oclfs/")) {
                violations.push({ file: from, reason: `postsolve must consume CurrentnessEvidence, not OCLFS internals: ${target}` });
            }
            if (target.startsWith("src/core/semanticflow/")) {
                violations.push({ file: from, reason: `postsolve must not import semanticflow: ${target}` });
            }
        }

        if (from.startsWith("src/core/assets/registry/") && target.startsWith("src/core/semanticflow/")) {
            violations.push({ file: from, reason: `asset registry must not import semanticflow: ${target}` });
        }
    }
    requireNoViolations("Architecture import boundary violations", violations);
}

function checkProductHygiene(): void {
    const tracked = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" })
        .split(/\r?\n/)
        .map(item => item.trim())
        .filter(Boolean);
    const forbiddenPrefixes = [
        "tmp/",
        "internal_docs/",
        "output/",
    ];
    const forbiddenRootPatterns = [
        /^draft.*\.md$/i,
        /^experiment.*\.md$/i,
        /^report_.*\.pdf$/i,
        /^report_.*_source\//i,
    ];
    const violations = tracked
        .filter(file => forbiddenPrefixes.some(prefix => file.startsWith(prefix)) || forbiddenRootPatterns.some(pattern => pattern.test(file)))
        .map(file => ({ file, reason: "generated/local artifact must not be tracked" }));
    requireNoViolations("Product hygiene violations", violations);
}

function checkRemovedPostsolveEntrypoints(): void {
    const forbiddenPaths = [
        "src/core/orchestration/postsolve/SafeOverwriteRefinement.ts",
        "src/core/orchestration/postsolve/DeleteBeforeReadRefinement.ts",
    ];
    const violations = forbiddenPaths
        .filter(file => fs.existsSync(path.resolve(ROOT, file)))
        .map(file => ({ file, reason: "old postsolve entrypoint must stay removed" }));
    requireNoViolations("Old postsolve entrypoint violations", violations);
}

function checkTrackedAssetFilesDoNotUseLegacyFields(): void {
    const assetFiles = [
        ...collectFiles(path.resolve(ROOT, "src/models"), file => /\.(json|ts)$/.test(file)),
        ...collectFiles(path.resolve(ROOT, "tests/rules"), file => /\.(json|ts)$/.test(file)),
    ];
    const forbidden = [
        "semanticsRef",
        "coverageSurfaces",
        "semantics.effects",
        "\"semantics\"",
        "FacadeSurface",
        "facade.alias",
    ];
    const violations: Violation[] = [];
    for (const file of assetFiles) {
        const text = fs.readFileSync(file, "utf8");
        for (const token of forbidden) {
            if (!text.includes(token)) continue;
            violations.push({ file: repoRelative(file), reason: `legacy asset field/token remains: ${token}` });
        }
    }
    requireNoViolations("Legacy asset field violations", violations);
}

function checkFullAnalysisSolvingBoundary(): void {
    const violations: Violation[] = [];
    const worklistPath = path.resolve(ROOT, "src/core/kernel/propagation/WorklistSolver.ts");
    const worklist = fs.existsSync(worklistPath) ? fs.readFileSync(worklistPath, "utf8") : "";
    if (worklist.includes("AssetDocumentBase") || worklist.includes("../assets") || worklist.includes("../../assets")) {
        violations.push({ file: repoRelative(worklistPath), reason: "WorklistSolver must not import or parse asset documents" });
    }
    const stagePath = path.resolve(ROOT, "src/core/orchestration/full_analysis/FullAnalysisStages.ts");
    if (!fs.existsSync(stagePath)) {
        violations.push({ file: repoRelative(stagePath), reason: "FullAnalysis solving stage boundary is missing" });
    }
    requireNoViolations("FullAnalysis solving boundary violations", violations);
}

function checkOldModuleLoweringPublicNameRemoved(): void {
    const files = collectTextFiles().filter(file => {
        const rel = repoRelative(file);
        if (rel === "src/tests/runtime/test_architecture_hygiene_gate.ts") return false;
        if (rel === "src/tests/runtime/test_layer_dependency_gate.ts") return false;
        return true;
    });
    const violations: Violation[] = [];
    for (const file of files) {
        const text = fs.readFileSync(file, "utf8");
        if (!text.includes(["Module", "Runtime", "Spec"].join(""))) continue;
        violations.push({ file: repoRelative(file), reason: "old public module lowering name remains" });
    }
    requireNoViolations("Old module lowering public-name violations", violations);
}

function checkInternalLoweringIrIsNotPublicProjectApi(): void {
    const moduleApiPath = path.resolve(ROOT, "src/core/kernel/contracts/ModuleApi.ts");
    const moduleApi = fs.readFileSync(moduleApiPath, "utf8");
    const violations: Violation[] = [];
    if (moduleApi.includes("InternalModuleLoweringIR")) {
        violations.push({
            file: repoRelative(moduleApiPath),
            reason: "InternalModuleLoweringIR must not be exported through the public project module API",
        });
    }
    requireNoViolations("Internal lowering public API violations", violations);
}

function checkGeneratedAssetAnalysisBypassRemoved(): void {
    const files = [
        "src/core/rules/RuleAssetLowering.ts",
        "src/core/kernel/contracts/ModuleAssetLowering.ts",
        "src/core/semanticflow/SemanticFlowArtifacts.ts",
        "src/core/orchestration/semanticflow/SemanticFlowRuntime.ts",
    ];
    const violations: Violation[] = [];
    for (const file of files) {
        const abs = path.resolve(ROOT, file);
        const text = fs.readFileSync(abs, "utf8");
        if (text.includes("includeGenerated")) {
            violations.push({
                file,
                reason: "generated/candidate asset lowering bypass must not exist",
            });
        }
    }
    requireNoViolations("Generated asset analysis bypass violations", violations);
}

function main(): void {
    checkImportBoundaries();
    checkProductHygiene();
    checkRemovedPostsolveEntrypoints();
    checkTrackedAssetFilesDoNotUseLegacyFields();
    checkFullAnalysisSolvingBoundary();
    checkOldModuleLoweringPublicNameRemoved();
    checkInternalLoweringIrIsNotPublicProjectApi();
    checkGeneratedAssetAnalysisBypassRemoved();
    console.log("PASS test_architecture_hygiene_gate");
    console.log("import_boundary_violations=0");
    console.log("product_hygiene_violations=0");
    console.log("old_postsolve_entrypoints=0");
    console.log("legacy_asset_field_violations=0");
    console.log("full_analysis_solving_boundary_violations=0");
    console.log("old_module_lowering_public_name_debt=0");
    console.log("internal_lowering_public_api_violations=0");
    console.log("generated_asset_analysis_bypass_violations=0");
}

main();
