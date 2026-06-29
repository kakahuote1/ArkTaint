import * as fs from "fs";
import * as path from "path";
import { assertValidCanonicalApiId, parseCanonicalApiId } from "../../core/api/identity";

interface JsonAsset {
    id?: string;
    plane?: string;
    status?: string;
    surfaces?: Array<Record<string, any>>;
    bindings?: Array<Record<string, any>>;
    effectTemplates?: Array<Record<string, any>>;
}

interface Finding {
    file: string;
    subject: string;
    reason: string;
}

const KERNEL_RULE_ROOT = path.resolve("src/models/kernel/rules");
const RETIRED_CORE_RULE_CATALOG_FILES = [
    path.resolve("src/core/rules/FrameworkApiSourceCatalog.ts"),
    path.resolve("src/core/rules/FrameworkCallbackSourceCatalog.ts"),
    path.resolve("src/core/rules/FrameworkSinkCatalog.ts"),
    path.resolve("src/core/rules/FrameworkSanitizerCatalog.ts"),
];

const bannedFileBasenames = new Set([
    "keyword.rules.json",
    "signature.rules.json",
    "demo_harmony_e2e.rules.json",
]);

function walkJsonFiles(root: string): string[] {
    const out: string[] = [];
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        const full = path.join(root, entry.name);
        if (entry.isDirectory()) {
            out.push(...walkJsonFiles(full));
        } else if (entry.isFile() && full.endsWith(".json")) {
            out.push(full);
        }
    }
    return out.sort();
}

function readAsset(file: string): JsonAsset {
    return JSON.parse(fs.readFileSync(file, "utf8")) as JsonAsset;
}

function rel(file: string): string {
    return path.relative(process.cwd(), file).replace(/\\/g, "/");
}

function pushIf(condition: boolean, findings: Finding[], file: string, subject: string, reason: string): void {
    if (condition) {
        findings.push({ file: rel(file), subject, reason });
    }
}

function isPseudoExactIdentity(value: unknown): boolean {
    if (typeof value !== "string") return false;
    if (value.length === 0) return true;
    if (value === ":" || value === "$" || value === "_$") return true;
    if (value.includes("A-Za-z") || value.includes("[") || value.includes("]")) return true;
    if (value.includes("\\") || value.includes("|")) return true;
    if (value.endsWith("$")) return true;
    if (value.startsWith(":.") || value.includes(":.")) return true;
    return false;
}

function inspectAsset(file: string, asset: JsonAsset, findings: Finding[]): void {
    const basename = path.basename(file);
    pushIf(
        bannedFileBasenames.has(basename),
        findings,
        file,
        basename,
        "kernel official assets must not use demo, keyword, or signature-only files",
    );

    pushIf(asset.plane !== "rule", findings, file, asset.id || "<unknown-asset>", `kernel rule asset must use plane=rule, got ${asset.plane}`);
    if (asset.status === "deprecated") {
        pushIf((asset.surfaces || []).length > 0, findings, file, asset.id || "<unknown-asset>", "deprecated kernel asset must not declare surfaces");
        pushIf((asset.bindings || []).length > 0, findings, file, asset.id || "<unknown-asset>", "deprecated kernel asset must not declare bindings");
        pushIf((asset.effectTemplates || []).length > 0, findings, file, asset.id || "<unknown-asset>", "deprecated kernel asset must not declare effect templates");
        inspectStructuredIdentityText(file, asset, findings);
        return;
    }
    pushIf(asset.status !== "official", findings, file, asset.id || "<unknown-asset>", `kernel rule asset must use status=official, got ${asset.status}`);
    inspectStructuredIdentityText(file, asset, findings);
    const surfacesById = new Map((asset.surfaces || []).map(surface => [surface.surfaceId, surface]));
    for (const surface of asset.surfaces || []) {
        inspectSurfaceIdentity(file, surface, findings);
    }
    for (const binding of asset.bindings || []) {
        const surface = binding.surfaceId ? surfacesById.get(binding.surfaceId) : undefined;
        inspectBindingIdentity(file, binding, surface, findings);
    }
}

function inspectSurfaceIdentity(file: string, surface: Record<string, any>, findings: Finding[]): void {
    const subject = surface.surfaceId || "<unknown-surface>";
    pushIf(!surface.canonicalApiId, findings, file, subject, "surface must declare canonicalApiId");
    if (typeof surface.canonicalApiId === "string") {
        inspectCanonicalApiId(file, subject, surface.canonicalApiId, findings);
    }
}

function inspectBindingIdentity(
    file: string,
    binding: Record<string, any>,
    surface: Record<string, any> | undefined,
    findings: Finding[],
): void {
    const subject = binding.bindingId || binding.id || "<unknown-binding>";
    pushIf(!surface, findings, file, subject, `binding references unknown surfaceId ${binding.surfaceId}`);
    pushIf(!binding.canonicalApiId, findings, file, subject, "binding must declare canonicalApiId");
    pushIf(!!binding.selector, findings, file, subject, "trusted kernel binding must not declare selector");
    pushIf(!!binding.__derivedSelector, findings, file, subject, "trusted kernel binding must not declare derived selector");
    if (surface && binding.canonicalApiId && surface.canonicalApiId) {
        pushIf(
            binding.canonicalApiId !== surface.canonicalApiId,
            findings,
            file,
            subject,
            "binding canonicalApiId must exactly match its surface canonicalApiId",
        );
    }
    if (typeof binding.canonicalApiId === "string") {
        inspectCanonicalApiId(file, subject, binding.canonicalApiId, findings);
    }
}

function inspectCanonicalApiId(file: string, subject: string, canonicalApiId: string, findings: Finding[]): void {
    try {
        assertValidCanonicalApiId(canonicalApiId);
        const parsed = parseCanonicalApiId(canonicalApiId);
        pushIf(
            parsed?.authority !== "official",
            findings,
            file,
            subject,
            `kernel official canonical identity must use authority=official, got ${parsed?.authority || "<invalid>"}`,
        );
    } catch (error) {
        findings.push({
            file: rel(file),
            subject,
            reason: error instanceof Error ? error.message : String(error),
        });
    }
    inspectOfficialText(file, `${subject}.canonicalApiId`, canonicalApiId, findings);
}

function inspectStructuredIdentityText(file: string, asset: JsonAsset, findings: Finding[]): void {
    const inspect = (subject: string, value: unknown): void => {
        const text = String(value || "");
        if (isPseudoExactIdentity(value)) {
            findings.push({
                file: rel(file),
                subject,
                reason: `kernel official identity must not contain regex fragments or pseudo owner: ${text}`,
            });
        }
        if (/(^|\.)sig(\.|$)/.test(text)) {
            findings.push({
                file: rel(file),
                subject,
                reason: `kernel official identity must not contain legacy signature-only segment: ${text}`,
            });
        }
    };
    inspect("asset.id", asset.id);
    for (const surface of asset.surfaces || []) {
        inspect(`${surface.surfaceId}.surfaceId`, surface.surfaceId);
        inspect(`${surface.surfaceId}.modulePath`, surface.modulePath);
        inspect(`${surface.surfaceId}.ownerName`, surface.ownerName);
        inspect(`${surface.surfaceId}.methodName`, surface.methodName);
        inspect(`${surface.surfaceId}.functionName`, surface.functionName);
    }
    for (const binding of asset.bindings || []) {
        inspect(`${binding.bindingId}.bindingId`, binding.bindingId);
        inspect(`${binding.bindingId}.surfaceId`, binding.surfaceId);
    }
}

function inspectOfficialText(file: string, subject: string, value: unknown, findings: Finding[]): void {
    const text = String(value || "");
    if (!text) return;
    if (text.includes("%unk") || text.includes("@%unk") || text.includes("@unk")) {
        findings.push({
            file: rel(file),
            subject,
            reason: `kernel official canonical identity must not contain unknown analyzer placeholders: ${text}`,
        });
    }
}

function main(): void {
    const findings: Finding[] = [];
    for (const file of walkJsonFiles(KERNEL_RULE_ROOT)) {
        inspectAsset(file, readAsset(file), findings);
    }
    for (const file of RETIRED_CORE_RULE_CATALOG_FILES) {
        pushIf(
            fs.existsSync(file),
            findings,
            file,
            path.basename(file),
            "retired framework catalog source file must not exist; official semantics must come from kernel assets",
        );
    }

    if (findings.length > 0) {
        console.error("Kernel official asset governance violations:");
        for (const finding of findings) {
            console.error(`- ${finding.file} :: ${finding.subject} :: ${finding.reason}`);
        }
        process.exitCode = 1;
        return;
    }

    console.log("kernel official asset governance: passed");
}

main();
