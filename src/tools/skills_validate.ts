import * as fs from "fs";
import * as path from "path";

interface SkillRegistryEntry {
    id: string;
    path: string;
    owners?: string[];
    tags?: string[];
    triggers?: string[];
    qualityGates?: string[];
}

interface SkillRegistry {
    schemaVersion: number;
    generatedAt?: string;
    skills: SkillRegistryEntry[];
}

interface ParsedSkillFrontmatter {
    id?: string;
    title?: string;
    version?: string;
    owners: string[];
    triggers: string[];
    qualityGateScripts: string[];
    references: string[];
}

export interface ValidationIssue {
    skillId?: string;
    severity: "error" | "warning";
    message: string;
}

export interface ValidationReport {
    generatedAt: string;
    registryPath: string;
    skillsCount: number;
    issues: ValidationIssue[];
}

function ensureDir(dir: string): void {
    fs.mkdirSync(dir, { recursive: true });
}

function parseArgs(argv: string[]): { registryPath: string; repoRoot: string } {
    let registryPath = "docs/skills/registry.json";
    let repoRoot = process.cwd();
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--registry" && argv[i + 1]) {
            registryPath = argv[i + 1];
            i++;
        } else if (arg.startsWith("--registry=")) {
            registryPath = arg.slice("--registry=".length);
        } else if (arg === "--repo-root" && argv[i + 1]) {
            repoRoot = path.resolve(argv[i + 1]);
            i++;
        } else if (arg.startsWith("--repo-root=")) {
            repoRoot = path.resolve(arg.slice("--repo-root=".length));
        }
    }
    return { registryPath, repoRoot };
}

function readJson<T>(absPath: string): T {
    const raw = fs.readFileSync(absPath, "utf-8");
    return JSON.parse(raw) as T;
}

function unquoteScalar(raw: string): string {
    const s = raw.trim();
    if ((s.startsWith("\"") && s.endsWith("\"")) || (s.startsWith("'") && s.endsWith("'"))) {
        return s.slice(1, -1);
    }
    return s;
}

/** Split SKILL.md into frontmatter text and body (after closing ---). */
function splitSkillMarkdown(markdown: string): { frontmatter: string; body: string } | null {
    const lines = markdown.split(/\r?\n/);
    if (lines.length < 2 || lines[0].trim() !== "---") {
        return null;
    }
    let end = -1;
    for (let i = 1; i < lines.length; i++) {
        if (lines[i].trim() === "---") {
            end = i;
            break;
        }
    }
    if (end < 0) {
        return null;
    }
    const frontmatter = lines.slice(1, end).join("\n");
    const body = lines.slice(end + 1).join("\n");
    return { frontmatter, body };
}

function parseSkillFrontmatter(fm: string): ParsedSkillFrontmatter | { error: string } {
    const lines = fm.split(/\r?\n/);
    const out: ParsedSkillFrontmatter = {
        owners: [],
        triggers: [],
        qualityGateScripts: [],
        references: [],
    };

    let i = 0;
    while (i < lines.length) {
        const line = lines[i];
        const trimmed = line.trim();
        if (!trimmed) {
            i++;
            continue;
        }

        const topKey = /^([A-Za-z0-9_]+):\s*(.*)$/.exec(line);
        if (!topKey || line.startsWith(" ") || line.startsWith("\t")) {
            return { error: `unexpected line in frontmatter at ${i + 1}: ${line}` };
        }
        const key = topKey[1];
        const rest = topKey[2];

        if (rest !== "") {
            if (key === "id") {
                out.id = unquoteScalar(rest);
            } else if (key === "title") {
                out.title = unquoteScalar(rest);
            } else if (key === "version") {
                out.version = unquoteScalar(rest);
            } else {
                return { error: `unsupported scalar frontmatter key: ${key}` };
            }
            i++;
            continue;
        }

        i++;
        if (key === "quality_gates") {
            while (i < lines.length && /^\s*-\s+script:/.test(lines[i])) {
                const m = /^\s*-\s+script:\s*"(.*)"\s*$/.exec(lines[i]);
                if (!m) {
                    return { error: `malformed quality_gates script line: ${lines[i]}` };
                }
                const script = m[1];
                let j = i + 1;
                if (j < lines.length && /^\s{4}why:\s*"/.test(lines[j])) {
                    j++;
                }
                out.qualityGateScripts.push(script);
                i = j;
            }
            continue;
        }

        const arr: string[] = [];
        while (i < lines.length && /^\s*-\s+/.test(lines[i])) {
            const item = lines[i].replace(/^\s*-\s+/, "").trim();
            arr.push(unquoteScalar(item));
            i++;
        }
        if (key === "owners") {
            out.owners = arr;
        } else if (key === "triggers") {
            out.triggers = arr;
        } else if (key === "references") {
            out.references = arr;
        } else {
            return { error: `unsupported list frontmatter key: ${key}` };
        }
    }

    return out;
}

function skillIdFromRegistryPath(relPath: string): string | undefined {
    const norm = relPath.replace(/\\/g, "/");
    const m = /^\.cursor\/skills\/(.+)\/SKILL\.md$/.exec(norm);
    return m ? m[1] : undefined;
}

function multisetEqual(a: string[], b: string[]): boolean {
    const na = [...a].map(s => s.trim()).filter(Boolean).sort((x, y) => x.localeCompare(y));
    const nb = [...b].map(s => s.trim()).filter(Boolean).sort((x, y) => x.localeCompare(y));
    if (na.length !== nb.length) {
        return false;
    }
    for (let i = 0; i < na.length; i++) {
        if (na[i] !== nb[i]) {
            return false;
        }
    }
    return true;
}

function resolveUnderRepo(repoRoot: string, ref: string): string | null {
    if (!ref || path.isAbsolute(ref)) {
        return null;
    }
    const abs = path.resolve(repoRoot, ref);
    const rel = path.relative(repoRoot, abs);
    if (rel.startsWith(`..${path.sep}`) || rel === "..") {
        return null;
    }
    return abs;
}

function bodyHasEscapedNewlineLiteral(body: string): boolean {
    return /\\n/.test(body);
}

function renderMarkdown(report: ValidationReport): string {
    const lines: string[] = [];
    lines.push("# Skills Validation Report");
    lines.push("");
    lines.push(`- generatedAt: ${report.generatedAt}`);
    lines.push(`- registryPath: ${report.registryPath}`);
    lines.push(`- skills: ${report.skillsCount}`);
    const errors = report.issues.filter(x => x.severity === "error");
    const warnings = report.issues.filter(x => x.severity === "warning");
    lines.push(`- errors: ${errors.length}`);
    lines.push(`- warnings: ${warnings.length}`);
    lines.push("");

    if (report.issues.length === 0) {
        lines.push("## Result");
        lines.push("");
        lines.push("- ✅ ok");
        lines.push("");
        return lines.join("\n");
    }

    const sections: Array<["Errors" | "Warnings", ValidationIssue[]]> = [
        ["Errors", errors],
        ["Warnings", warnings],
    ];
    for (const [title, items] of sections) {
        lines.push(`## ${title}`);
        lines.push("");
        if (items.length === 0) {
            lines.push("- none");
            lines.push("");
            continue;
        }
        for (const item of items) {
            const prefix = item.skillId ? `(${item.skillId}) ` : "";
            lines.push(`- ${prefix}${item.message}`);
        }
        lines.push("");
    }
    return lines.join("\n");
}

export function validateSkills(registryPath: string, repoRoot: string): ValidationReport {
    const registryAbs = path.resolve(repoRoot, registryPath);
    const issues: ValidationIssue[] = [];
    const generatedAt = new Date().toISOString();

    if (!fs.existsSync(registryAbs)) {
        return {
            generatedAt,
            registryPath,
            skillsCount: 0,
            issues: [{ severity: "error", message: `registry not found: ${registryPath}` }],
        };
    }

    let registry: SkillRegistry;
    try {
        registry = readJson<SkillRegistry>(registryAbs);
    } catch {
        return {
            generatedAt,
            registryPath,
            skillsCount: 0,
            issues: [{ severity: "error", message: `failed to parse registry json: ${registryPath}` }],
        };
    }

    const packageJsonAbs = path.resolve(repoRoot, "package.json");
    const scripts = fs.existsSync(packageJsonAbs)
        ? (readJson<Record<string, unknown>>(packageJsonAbs)?.scripts ?? {}) as Record<string, string>
        : {};

    const seenIds = new Set<string>();
    const seenPaths = new Map<string, string>();

    for (const skill of registry.skills ?? []) {
        if (!skill.id) {
            issues.push({ severity: "error", message: "skill missing id" });
            continue;
        }
        if (seenIds.has(skill.id)) {
            issues.push({ skillId: skill.id, severity: "error", message: "duplicate skill id in registry" });
        }
        seenIds.add(skill.id);

        if (!skill.path) {
            issues.push({ skillId: skill.id, severity: "error", message: "skill missing path" });
            continue;
        }

        const expectedId = skillIdFromRegistryPath(skill.path);
        if (!expectedId) {
            issues.push({
                skillId: skill.id,
                severity: "error",
                message: `skill path must match .cursor/skills/<group>/<name>/SKILL.md (got ${skill.path})`,
            });
            continue;
        }
        if (expectedId !== skill.id) {
            issues.push({
                skillId: skill.id,
                severity: "error",
                message: `skill id ${skill.id} does not match path-derived id ${expectedId}`,
            });
        }

        const skillAbs = path.resolve(repoRoot, skill.path);
        const prevId = seenPaths.get(skillAbs);
        if (prevId) {
            issues.push({
                skillId: skill.id,
                severity: "error",
                message: `duplicate skill file path in registry (also used by ${prevId}): ${skill.path}`,
            });
        } else {
            seenPaths.set(skillAbs, skill.id);
        }

        if (!fs.existsSync(skillAbs)) {
            issues.push({ skillId: skill.id, severity: "error", message: `skill file not found: ${skill.path}` });
            continue;
        }

        const content = fs.readFileSync(skillAbs, "utf-8");
        const split = splitSkillMarkdown(content);
        if (!split) {
            issues.push({ skillId: skill.id, severity: "error", message: "missing or malformed YAML frontmatter (--- ... ---) at file top" });
            continue;
        }

        if (bodyHasEscapedNewlineLiteral(split.body)) {
            issues.push({
                skillId: skill.id,
                severity: "error",
                message: "SKILL body contains literal \\\\n sequence; use real newlines",
            });
        }

        const parsed = parseSkillFrontmatter(split.frontmatter);
        if ("error" in parsed) {
            issues.push({ skillId: skill.id, severity: "error", message: `frontmatter parse error: ${parsed.error}` });
            continue;
        }

        if (!parsed.id) {
            issues.push({ skillId: skill.id, severity: "error", message: "frontmatter missing id" });
        } else if (parsed.id !== skill.id) {
            issues.push({
                skillId: skill.id,
                severity: "error",
                message: `frontmatter id ${parsed.id} does not match registry id ${skill.id}`,
            });
        }

        if (!parsed.title || !parsed.title.trim()) {
            issues.push({ skillId: skill.id, severity: "error", message: "frontmatter title missing or empty" });
        }
        if (!parsed.version || !parsed.version.trim()) {
            issues.push({ skillId: skill.id, severity: "error", message: "frontmatter version missing or empty" });
        }
        if (!parsed.owners.length) {
            issues.push({ skillId: skill.id, severity: "error", message: "frontmatter owners must be a non-empty array" });
        }
        if (!parsed.triggers.length) {
            issues.push({ skillId: skill.id, severity: "error", message: "frontmatter triggers must be a non-empty array" });
        }
        if (!parsed.qualityGateScripts.length) {
            issues.push({ skillId: skill.id, severity: "error", message: "frontmatter quality_gates must be non-empty" });
        }
        if (!parsed.references.length) {
            issues.push({ skillId: skill.id, severity: "error", message: "frontmatter references must be a non-empty array" });
        }

        const regOwners = skill.owners ?? [];
        const regTriggers = skill.triggers ?? [];
        const regGates = skill.qualityGates ?? [];

        if (!multisetEqual(regOwners, parsed.owners)) {
            issues.push({
                skillId: skill.id,
                severity: "error",
                message: `registry owners does not match SKILL.md owners (registry=${JSON.stringify(regOwners)} skill=${JSON.stringify(parsed.owners)})`,
            });
        }
        if (!multisetEqual(regTriggers, parsed.triggers)) {
            issues.push({
                skillId: skill.id,
                severity: "error",
                message: `registry triggers does not match SKILL.md triggers`,
            });
        }
        if (!multisetEqual(regGates, parsed.qualityGateScripts)) {
            issues.push({
                skillId: skill.id,
                severity: "error",
                message: `registry qualityGates does not match SKILL.md quality_gates scripts (registry=${JSON.stringify(regGates)} skill=${JSON.stringify(parsed.qualityGateScripts)})`,
            });
        }

        for (const ref of parsed.references) {
            if (!ref || !ref.trim()) {
                issues.push({ skillId: skill.id, severity: "error", message: "empty references entry" });
                continue;
            }
            const refAbs = resolveUnderRepo(repoRoot, ref);
            if (!refAbs) {
                issues.push({ skillId: skill.id, severity: "error", message: `unsafe reference path: ${ref}` });
                continue;
            }
            if (!fs.existsSync(refAbs)) {
                issues.push({ skillId: skill.id, severity: "error", message: `reference not found: ${ref}` });
            }
        }

        for (const gate of regGates) {
            if (!scripts[gate]) {
                issues.push({ skillId: skill.id, severity: "error", message: `qualityGate script not found in package.json: ${gate}` });
            }
        }
    }

    return {
        generatedAt,
        registryPath,
        skillsCount: (registry.skills ?? []).length,
        issues,
    };
}

function writeReports(report: ValidationReport, repoRoot: string): void {
    const outDir = path.resolve(repoRoot, "tmp", "test_runs", "_skills", "latest");
    ensureDir(outDir);
    const jsonPath = path.join(outDir, "skills_validation.json");
    const mdPath = path.join(outDir, "skills_validation.md");
    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), "utf-8");
    fs.writeFileSync(mdPath, renderMarkdown(report), "utf-8");
}

function main(): void {
    const { registryPath, repoRoot } = parseArgs(process.argv.slice(2));
    const report = validateSkills(registryPath, repoRoot);
    writeReports(report, repoRoot);

    const errors = report.issues.filter(i => i.severity === "error").length;
    const warnings = report.issues.filter(i => i.severity === "warning").length;
    console.log("====== Skills Validation ======");
    console.log(`skills=${report.skillsCount}`);
    console.log(`errors=${errors}`);
    console.log(`warnings=${warnings}`);
    console.log(`report_json=${path.resolve(repoRoot, "tmp", "test_runs", "_skills", "latest", "skills_validation.json")}`);
    console.log(`report_md=${path.resolve(repoRoot, "tmp", "test_runs", "_skills", "latest", "skills_validation.md")}`);

    if (errors > 0) {
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}
