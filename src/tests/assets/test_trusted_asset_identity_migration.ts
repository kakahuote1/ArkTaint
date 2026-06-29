import * as fs from "fs";
import * as path from "path";
import { assertValidCanonicalApiId, parseCanonicalApiId } from "../../core/api/identity/CanonicalApiId";

const ROOT = process.cwd();
const trustedStatuses = new Set(["official", "reviewed", "replayed", "candidate", "llm-generated", "schema-valid"]);

function main(): void {
    const files = [
        ...walk("src/models/kernel", file => file.endsWith(".json")),
        ...walk("tests", file => file.endsWith(".rules.json")),
    ];
    const errors: string[] = [];
    for (const file of files) {
        const asset = readJson(file);
        if (!asset || typeof asset !== "object" || !trustedStatuses.has(String(asset.status || ""))) continue;
        validateNoLegacySelector(file, asset, errors);
        validateSurfaces(file, asset, errors);
        validateBindings(file, asset, errors);
    }
    if (errors.length > 0) {
        throw new Error(`trusted asset identity migration audit failed:\n${errors.join("\n")}`);
    }
}

function walk(dir: string, predicate: (file: string) => boolean, out: string[] = []): string[] {
    const root = path.resolve(ROOT, dir);
    if (!fs.existsSync(root)) return out;
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        const absolute = path.join(root, entry.name);
        const relative = path.relative(ROOT, absolute).replace(/\\/g, "/");
        if (entry.isDirectory()) {
            walk(relative, predicate, out);
        } else if (predicate(relative)) {
            out.push(relative);
        }
    }
    return out;
}

function readJson(file: string): any {
    return JSON.parse(fs.readFileSync(path.resolve(ROOT, file), "utf8"));
}

function validateNoLegacySelector(file: string, value: unknown, errors: string[], location = "$"): void {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
        value.forEach((item, index) => validateNoLegacySelector(file, item, errors, `${location}[${index}]`));
        return;
    }
    for (const [key, child] of Object.entries(value)) {
        if (key === "selector") errors.push(`${file}:${location}.selector is forbidden`);
        validateNoLegacySelector(file, child, errors, `${location}.${key}`);
    }
}

function validateSurfaces(file: string, asset: any, errors: string[]): void {
    for (const [index, surface] of (asset.surfaces || []).entries()) {
        const location = `${file}:surfaces[${index}]`;
        validateCanonical(location, surface.canonicalApiId, errors);
        if (surface.kind === "invoke" || surface.kind === "construct") {
            const methodKey = surface.evidence?.arkanalyzer?.methodKey;
            if (!methodKey || typeof methodKey !== "object") {
                if (file.startsWith("src/models/kernel/")) {
                    errors.push(`${location}.evidence.arkanalyzer.methodKey is required`);
                }
            } else {
                if (!Array.isArray(methodKey.parameterTypes)) {
                    errors.push(`${location}.evidence.arkanalyzer.methodKey.parameterTypes is required`);
                }
                if (!isExactType(methodKey.returnType)) {
                    errors.push(`${location}.evidence.arkanalyzer.methodKey.returnType is required and must be exact`);
                }
                if (!isExactType(methodKey.declaringFileName)) {
                    errors.push(`${location}.evidence.arkanalyzer.methodKey.declaringFileName is required and must be exact`);
                }
                if (!isExactType(methodKey.declaringClassName)) {
                    errors.push(`${location}.evidence.arkanalyzer.methodKey.declaringClassName is required and must be exact`);
                }
                if (!isExactType(methodKey.methodName)) {
                    errors.push(`${location}.evidence.arkanalyzer.methodKey.methodName is required and must be exact`);
                }
                if (typeof methodKey.staticFlag !== "boolean") {
                    errors.push(`${location}.evidence.arkanalyzer.methodKey.staticFlag must be boolean`);
                }
            }
        }
        const parsed = parseCanonicalApiId(String(surface.canonicalApiId || ""));
        if (parsed?.module.includes("@arktaint") && parsed.authority !== "project") {
            errors.push(`${location}.canonicalApiId synthetic @arktaint asset must use project authority`);
        }
    }
}

function validateBindings(file: string, asset: any, errors: string[]): void {
    const surfaces = new Map((asset.surfaces || []).map((surface: any) => [surface.surfaceId, surface]));
    for (const [index, binding] of (asset.bindings || []).entries()) {
        const location = `${file}:bindings[${index}]`;
        validateCanonical(location, binding.canonicalApiId, errors);
        const surface = surfaces.get(binding.surfaceId) as any;
        if (!surface) {
            errors.push(`${location}.surfaceId references missing surface ${binding.surfaceId}`);
        } else if (binding.canonicalApiId !== surface.canonicalApiId) {
            errors.push(`${location}.canonicalApiId must match surface ${binding.surfaceId}`);
        }
    }
}

function validateCanonical(location: string, value: unknown, errors: string[]): void {
    if (typeof value !== "string" || value.length === 0) {
        errors.push(`${location}.canonicalApiId is required`);
        return;
    }
    try {
        assertValidCanonicalApiId(value);
    } catch (error) {
        errors.push(`${location}.canonicalApiId ${error instanceof Error ? error.message : String(error)}`);
    }
    if (value.includes("ret=unknown") || value.includes("%unk") || value.includes("@unk")) {
        errors.push(`${location}.canonicalApiId contains unknown evidence`);
    }
}

function isExactType(value: unknown): value is string {
    if (typeof value !== "string") return false;
    const text = value.trim().toLowerCase();
    return !!text && text !== "unknown" && !text.includes("%unk") && !text.includes("@unk");
}

main();
