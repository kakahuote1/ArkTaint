import * as fs from "fs";
import * as path from "path";

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
const CORE_RULE_CATALOG_FILES = [
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

const forbiddenOfficialTokens = [
    "axios",
    "@ohos/axios",
    "flutter",
    "flutter_ohos",
    "mqtt",
    "@ohos/mqtt",
    "wearengine",
    "WearEngine",
    "GlobalContext",
    "RuntimeSelector",
    "@arktaint/runtime-selector",
    "taint_mock",
    "tests/demo",
    "project.",
    "wrapper.",
];

const broadSelectorKinds = new Set([
    "signature-contains",
    "signature-regex",
    "method-name-regex",
    "local-name-regex",
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

function inspectScopeConstraint(
    findings: Finding[],
    file: string,
    subject: string,
    scope: any,
): void {
    if (!scope || typeof scope !== "object") return;
    for (const field of ["file", "module", "className", "methodName"]) {
        const constraint = scope[field];
        if (!constraint || typeof constraint !== "object") continue;
        pushIf(
            constraint.mode !== "equals",
            findings,
            file,
            `${subject}.${field}`,
            `kernel official scope must use equals, got ${constraint.mode}`,
        );
        pushIf(
            isPseudoExactIdentity(constraint.value),
            findings,
            file,
            `${subject}.${field}`,
            `kernel official scope must not contain regex fragments or pseudo owner: ${constraint.value}`,
        );
    }
}

function isPseudoExactIdentity(value: unknown): boolean {
    if (typeof value !== "string") return false;
    if (value.length === 0) return true;
    if (value === ":" || value === "$" || value === "_$") return true;
    if (value.includes("A-Za-z") || value.includes("[") || value.includes("]")) return true;
    if (value.includes("(") || value.includes(")") || value.includes("*") || value.includes("?")) return true;
    if (value.includes("\\") || value.includes("|")) return true;
    if (value.endsWith("$")) return true;
    if (value.startsWith(":.") || value.includes(":.")) return true;
    return false;
}

function inspectSelector(findings: Finding[], file: string, binding: Record<string, any>): void {
    const selector = binding.selector || binding.__derivedSelector;
    const subject = binding.bindingId || binding.id || "<unknown-binding>";
    pushIf(!selector, findings, file, subject, "binding must declare an explicit selector");
    if (!selector || typeof selector !== "object") return;

    pushIf(
        broadSelectorKinds.has(selector.kind),
        findings,
        file,
        subject,
        `broad selector kind is forbidden in official kernel assets: ${selector.kind}`,
    );
    inspectScopeConstraint(findings, file, subject, selector.scope);
    inspectScopeConstraint(findings, file, `${subject}.calleeScope`, selector.calleeScope);
    if (selector.calleeClass && selector.calleeClass.mode !== "equals") {
        findings.push({
            file: rel(file),
            subject: `${subject}.calleeClass`,
            reason: `kernel official calleeClass must use equals, got ${selector.calleeClass.mode}`,
        });
    }
}

function inspectAsset(file: string, asset: JsonAsset, findings: Finding[]): void {
    const basename = path.basename(file);
    pushIf(
        bannedFileBasenames.has(basename),
        findings,
        file,
        basename,
        "kernel official assets must not use demo, keyword, or signature fallback files",
    );

    const surfacesById = new Map((asset.surfaces || []).map(surface => [surface.surfaceId, surface]));
    inspectForbiddenTokens(file, asset, findings);
    for (const binding of asset.bindings || []) {
        const surface = binding.surfaceId ? surfacesById.get(binding.surfaceId) : undefined;
        const derivedSelector = binding.selector || selectorFromSurface(surface);
        inspectSelector(findings, file, { ...binding, __derivedSelector: derivedSelector });
    }
}

function inspectForbiddenTokens(file: string, asset: JsonAsset, findings: Finding[]): void {
    const inspect = (subject: string, value: unknown): void => {
        const text = String(value || "");
        for (const token of forbiddenOfficialTokens) {
            if (text.includes(token)) {
                findings.push({
                    file: rel(file),
                    subject,
                    reason: `kernel official identity must not contain third-party, project, test, or wrapper token: ${token}`,
                });
            }
        }
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
                reason: `kernel official identity must not contain legacy signature fallback segment: ${text}`,
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
        inspect(`${binding.bindingId}.selector.value`, binding.selector?.value);
        inspect(`${binding.bindingId}.selector.typeHint`, binding.selector?.typeHint);
        inspect(`${binding.bindingId}.selector.scope.module`, binding.selector?.scope?.module?.value);
        inspect(`${binding.bindingId}.selector.scope.className`, binding.selector?.scope?.className?.value);
        inspect(`${binding.bindingId}.selector.calleeScope.module`, binding.selector?.calleeScope?.module?.value);
        inspect(`${binding.bindingId}.selector.calleeScope.className`, binding.selector?.calleeScope?.className?.value);
        inspect(`${binding.bindingId}.selector.calleeClass`, binding.selector?.calleeClass?.value);
    }
}

function selectorFromSurface(surface: any): any | undefined {
    if (!surface || surface.kind !== "invoke") return undefined;
    if (surface.methodName) {
        return {
            kind: "method-name-equals",
            value: surface.methodName,
            invokeKind: surface.invokeKind,
            argCount: surface.argCount,
            typeHint: surface.ownerName,
            calleeScope: surface.ownerName
                ? { className: { mode: "equals", value: surface.ownerName } }
                : undefined,
        };
    }
    if (surface.functionName) {
        return {
            kind: "method-name-equals",
            value: surface.functionName,
            invokeKind: surface.invokeKind,
            argCount: surface.argCount,
        };
    }
    return undefined;
}

function inspectCatalogText(file: string, findings: Finding[]): void {
    const text = fs.readFileSync(file, "utf8");
    const thirdPartyTokens = [
        "axios",
        "@ohos/axios",
        "flutter",
        "flutter_ohos",
        "mqtt",
        "@ohos/mqtt",
        "wearengine",
        "WearEngine",
    ];
    for (const token of thirdPartyTokens) {
        if (text.includes(token)) {
            findings.push({
                file: rel(file),
                subject: token,
                reason: `framework catalog must not contain third-party token: ${token}`,
            });
        }
    }
}

function main(): void {
    const findings: Finding[] = [];
    for (const file of walkJsonFiles(KERNEL_RULE_ROOT)) {
        inspectAsset(file, readAsset(file), findings);
    }
    for (const file of CORE_RULE_CATALOG_FILES) {
        inspectCatalogText(file, findings);
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
