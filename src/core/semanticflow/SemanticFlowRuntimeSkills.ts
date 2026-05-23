import { createHash } from "crypto";
import * as fs from "fs";
import * as path from "path";

export interface SemanticFlowRuntimeSkill {
    id: string;
    title: string;
    version: string;
    body: string;
}

const RUNTIME_SKILL_FILES = [
    "asset-plane-selection/SKILL.md",
    "project-api-modeling/SKILL.md",
    "evidence-and-safety/SKILL.md",
] as const;

let cachedSkills: SemanticFlowRuntimeSkill[] | undefined;
let cachedFingerprint: string | undefined;

export function loadSemanticFlowRuntimeSkills(): SemanticFlowRuntimeSkill[] {
    if (cachedSkills) {
        return cachedSkills;
    }
    const root = resolveRuntimeSkillRoot();
    cachedSkills = RUNTIME_SKILL_FILES.map(relPath => {
        const absPath = path.join(root, relPath);
        const raw = fs.readFileSync(absPath, "utf-8");
        return parseRuntimeSkill(raw, relPath);
    });
    return cachedSkills;
}

export function formatSemanticFlowRuntimeSkills(skills = loadSemanticFlowRuntimeSkills()): string {
    return skills.map(skill => [
        `## Runtime skill: ${skill.id}`,
        `title: ${skill.title}`,
        `version: ${skill.version}`,
        "",
        skill.body.trim(),
    ].join("\n")).join("\n\n");
}

export function getSemanticFlowRuntimeSkillsFingerprint(): string {
    if (cachedFingerprint) {
        return cachedFingerprint;
    }
    const root = resolveRuntimeSkillRoot();
    const payload = RUNTIME_SKILL_FILES.map(relPath => {
        const absPath = path.join(root, relPath);
        return {
            path: relPath,
            sha256: sha256Hex(fs.readFileSync(absPath)),
        };
    });
    cachedFingerprint = sha256Hex(JSON.stringify(payload));
    return cachedFingerprint;
}

function resolveRuntimeSkillRoot(): string {
    const candidates = [
        path.resolve(process.cwd(), "src", "core", "semanticflow", "llm_skills"),
        path.resolve(__dirname, "..", "..", "..", "src", "core", "semanticflow", "llm_skills"),
    ];
    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }
    throw new Error(`runtime LLM skills not found; checked ${candidates.join(", ")}`);
}

function parseRuntimeSkill(raw: string, relPath: string): SemanticFlowRuntimeSkill {
    const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(raw);
    if (!match) {
        throw new Error(`runtime LLM skill missing frontmatter: ${relPath}`);
    }
    const frontmatter = parseFrontmatter(match[1], relPath);
    return {
        id: frontmatter.id,
        title: frontmatter.title,
        version: frontmatter.version,
        body: match[2].trim(),
    };
}

function parseFrontmatter(raw: string, relPath: string): { id: string; title: string; version: string } {
    const out: Record<string, string> = {};
    for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) {
            continue;
        }
        const match = /^([A-Za-z0-9_-]+):\s*"?(.*?)"?\s*$/.exec(trimmed);
        if (!match) {
            throw new Error(`runtime LLM skill frontmatter line invalid in ${relPath}: ${line}`);
        }
        out[match[1]] = match[2];
    }
    for (const key of ["id", "title", "version"]) {
        if (!out[key]) {
            throw new Error(`runtime LLM skill frontmatter missing ${key}: ${relPath}`);
        }
    }
    return {
        id: out.id,
        title: out.title,
        version: out.version,
    };
}

function sha256Hex(value: string | Buffer): string {
    return createHash("sha256").update(value).digest("hex");
}
