#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const ROOT = process.cwd();

registerTypeScriptRequire();

const { validateAssetDocument } = require(path.resolve(ROOT, "src/core/assets/schema/AssetSchemaValidator"));
const { canonicalApiDescriptorFromIdSeed } = require(path.resolve(ROOT, "src/core/api/identity/CanonicalApiDescriptorFromId"));
const { assertValidCanonicalApiId, parseCanonicalApiId } = require(path.resolve(ROOT, "src/core/api/identity/CanonicalApiId"));

const RULE_DIRS = [
    { family: "rules/sources", dir: "src/models/kernel/rules/sources", plane: "rule", roles: new Set(["source"]) },
    { family: "rules/sinks", dir: "src/models/kernel/rules/sinks", plane: "rule", roles: new Set(["sink"]) },
    { family: "rules/transfers", dir: "src/models/kernel/rules/transfers", plane: "rule", roles: new Set(["transfer"]) },
    { family: "rules/sanitizers", dir: "src/models/kernel/rules/sanitizers", plane: "rule", roles: new Set(["sanitizer"]) },
];

const MODULE_DIR = "src/models/kernel/modules";

const ARKMAIN_API_ASSETS = [
    "src/models/kernel/arkmain/harmony/official_declarations.catalog.json",
];

const REMOVED_ARKMAIN_INTERNAL_CATALOGS = [
    "src/models/kernel/arkmain/harmony/framework.catalog.json",
    "src/models/kernel/arkmain/harmony/lifecycle.contracts.json",
];

const FORBIDDEN_ASSET_KEYS = new Set([
    "schemaVersion",
    "modelVersion",
    "assetVersion",
    "semanticsRef",
    "coverageSurfaces",
    "runtimeShape",
    "modulePath",
    "ownerName",
    "functionName",
    "methodName",
    "invokeKind",
    "argCount",
    "parameterTypes",
    "returnType",
    "signatureId",
    "callee_signature",
    "sourceFile",
    "decoratorName",
    "startMethods",
    "targetMethods",
    "stateDecorators",
    "propDecorators",
    "linkDecorators",
    "provideDecorators",
    "consumeDecorators",
    "eventDecorators",
    "ValueEndpoint",
    "ModelStatus",
]);

const ALLOWED_OFFICIAL_DOMAINS = new Set(["openharmony", "arkui", "arkts", "tsjs"]);
const RULE_TEMPLATE_KIND_BY_ROLE = {
    source: "rule.source",
    sink: "rule.sink",
    transfer: "rule.transfer",
    sanitizer: "rule.sanitizer",
};

function registerTypeScriptRequire() {
    require.extensions[".ts"] = (module, filename) => {
        const source = fs.readFileSync(filename, "utf8");
        const compiled = ts.transpileModule(source, {
            compilerOptions: {
                target: ts.ScriptTarget.ES2021,
                module: ts.ModuleKind.CommonJS,
                esModuleInterop: true,
                skipLibCheck: true,
            },
            fileName: filename,
        });
        module._compile(compiled.outputText, filename);
    };
}

function main() {
    const entries = [
        ...loadRuleAssets(),
        ...loadModuleAssets(),
        ...loadArkmainApiAssets(),
    ];
    const descriptors = createDescriptorMap(entries.flatMap(entry => entry.assets));
    const failures = [];
    const summary = {
        files: entries.length,
        assets: 0,
        surfaces: 0,
        bindings: 0,
        templates: 0,
        canonicalApiIds: descriptors.size,
    };

    for (const entry of entries) {
        const entryFailures = [];
        for (const asset of entry.assets) {
            summary.assets += 1;
            summary.surfaces += arrayOf(asset.surfaces).length;
            summary.bindings += arrayOf(asset.bindings).length;
            summary.templates += arrayOf(asset.effectTemplates).length;
            validateAsset(entry, asset, descriptors, entryFailures);
        }
        if (entryFailures.length > 0) {
            failures.push({ file: entry.file, failures: entryFailures });
        }
    }

    for (const file of REMOVED_ARKMAIN_INTERNAL_CATALOGS) {
        validateRemovedInternalCatalog(file, failures);
    }

    if (failures.length > 0) {
        console.error("[kernel-asset-identity-closure] FAIL");
        for (const item of failures.slice(0, 30)) {
            console.error(`- ${item.file}`);
            for (const failure of item.failures.slice(0, 20)) {
                console.error(`  - ${failure}`);
            }
            if (item.failures.length > 20) {
                console.error(`  - ... ${item.failures.length - 20} more`);
            }
        }
        if (failures.length > 30) {
            console.error(`- ... ${failures.length - 30} more files`);
        }
        process.exit(1);
    }

    console.log("[kernel-asset-identity-closure] PASS");
    console.log(JSON.stringify(summary, null, 2));
}

function loadRuleAssets() {
    return RULE_DIRS.flatMap(ruleDir => {
        return listFiles(ruleDir.dir, ".json").map(file => ({
            family: ruleDir.family,
            file,
            expectedPlane: ruleDir.plane,
            expectedRoles: ruleDir.roles,
            assets: [readJson(file)],
        }));
    });
}

function loadModuleAssets() {
    return listFiles(MODULE_DIR, ".ts").flatMap(file => {
        const loaded = require(abs(file));
        const exported = loaded && loaded.default !== undefined ? loaded.default : loaded;
        const assets = (Array.isArray(exported) ? exported : [exported]).filter(isAssetDocumentLike);
        if (assets.length === 0) return [];
        return {
            family: "modules",
            file,
            expectedPlane: "module",
            expectedRoles: new Set(["handoff", "module", "callback-registration"]),
            assets,
        };
    });
}

function loadArkmainApiAssets() {
    return ARKMAIN_API_ASSETS.map(file => ({
        family: "arkmain",
        file,
        expectedPlane: "arkmain",
        expectedRoles: new Set(["entry", "arkmain"]),
        assets: [readJson(file)],
    }));
}

function validateAsset(entry, asset, descriptors, failures) {
    if (!isPlainObject(asset)) {
        failures.push("asset export must be an object");
        return;
    }

    const schema = validateAssetDocument(asset, {
        canonicalApiDescriptors: descriptors,
    });
    if (!schema.valid) {
        for (const error of schema.errors || []) failures.push(`schema: ${error}`);
    }

    if (asset.plane !== entry.expectedPlane) {
        failures.push(`asset ${asset.id || "<missing id>"} plane ${asset.plane} does not match ${entry.expectedPlane}`);
    }
    if (asset.status !== "official") {
        failures.push(`asset ${asset.id || "<missing id>"} must be official, got ${asset.status}`);
    }

    walkForbiddenAssetKeys(asset, "$", failures);
    validateSurfaceBindingTemplateClosure(entry, asset, failures);
}

function validateSurfaceBindingTemplateClosure(entry, asset, failures) {
    const surfaces = arrayOf(asset.surfaces);
    const bindings = arrayOf(asset.bindings);
    const templates = arrayOf(asset.effectTemplates);
    const surfacesById = new Map();
    const templatesById = new Map();
    const surfaceCanonicalIds = new Set();
    const bindingCanonicalIds = new Set();

    for (const [index, surface] of surfaces.entries()) {
        const where = `${asset.id || "<missing id>"}.surfaces[${index}]`;
        if (!isPlainObject(surface)) {
            failures.push(`${where} must be an object`);
            continue;
        }
        if (surfacesById.has(surface.surfaceId)) failures.push(`${where} duplicates surfaceId ${surface.surfaceId}`);
        surfacesById.set(surface.surfaceId, surface);
        validateCanonicalIdentity(surface.canonicalApiId, `${where}.canonicalApiId`, failures);
        if (typeof surface.canonicalApiId === "string") {
            surfaceCanonicalIds.add(surface.canonicalApiId);
            if (surface.surfaceId !== `surface:${surface.canonicalApiId}`) {
                failures.push(`${where}.surfaceId must be surface:<canonicalApiId>`);
            }
        }
        if (surface.kind === "invoke" || surface.kind === "construct") {
            validateArkanalyzerMethodKey(surface.evidence && surface.evidence.arkanalyzer && surface.evidence.arkanalyzer.methodKey, where, failures);
        }
    }

    for (const [index, template] of templates.entries()) {
        const where = `${asset.id || "<missing id>"}.effectTemplates[${index}]`;
        if (!isPlainObject(template)) {
            failures.push(`${where} must be an object`);
            continue;
        }
        if (templatesById.has(template.id)) failures.push(`${where} duplicates template id ${template.id}`);
        templatesById.set(template.id, template);
        validateTemplateNoUnknowns(template, where, failures);
    }

    for (const [index, binding] of bindings.entries()) {
        const where = `${asset.id || "<missing id>"}.bindings[${index}]`;
        if (!isPlainObject(binding)) {
            failures.push(`${where} must be an object`);
            continue;
        }
        if (!entry.expectedRoles.has(binding.role)) {
            failures.push(`${where}.role ${binding.role} is not expected for ${entry.family}`);
        }
        const surface = surfacesById.get(binding.surfaceId);
        if (!surface) {
            failures.push(`${where}.surfaceId references missing surface ${binding.surfaceId}`);
        } else if (binding.canonicalApiId !== surface.canonicalApiId) {
            failures.push(`${where}.canonicalApiId must exactly match its surface canonicalApiId`);
        }
        validateCanonicalIdentity(binding.canonicalApiId, `${where}.canonicalApiId`, failures);
        if (typeof binding.canonicalApiId === "string") bindingCanonicalIds.add(binding.canonicalApiId);
        if (!Array.isArray(binding.effectTemplateRefs) || binding.effectTemplateRefs.length === 0) {
            failures.push(`${where}.effectTemplateRefs must not be empty`);
        } else {
            for (const ref of binding.effectTemplateRefs) {
                const template = templatesById.get(ref);
                if (!template) {
                    failures.push(`${where}.effectTemplateRefs references missing template ${ref}`);
                    continue;
                }
                validateRoleTemplateCompatibility(binding.role, template, `${where}.effectTemplateRefs ${ref}`, failures);
            }
        }
        validateBindingEndpointRequirement(binding, where, failures);
    }

    for (const canonicalApiId of surfaceCanonicalIds) {
        if (!bindingCanonicalIds.has(canonicalApiId)) {
            failures.push(`surface canonicalApiId has no binding: ${canonicalApiId}`);
        }
    }
}

function validateCanonicalIdentity(value, where, failures) {
    if (typeof value !== "string" || value.trim() === "") {
        failures.push(`${where} is required`);
        return;
    }
    try {
        assertValidCanonicalApiId(value);
    } catch (error) {
        failures.push(`${where} invalid: ${error.message}`);
        return;
    }
    const parts = parseCanonicalApiId(value);
    if (!parts || parts.authority !== "official") {
        failures.push(`${where} must use official authority`);
        return;
    }
    if (!ALLOWED_OFFICIAL_DOMAINS.has(parts.domain)) {
        failures.push(`${where} uses unsupported official domain ${parts.domain}`);
    }
    const decoded = Object.values(parts).join(" ");
    if (decoded.includes("%unk") || decoded.includes("@%unk") || decoded.includes("@unk")) {
        failures.push(`${where} contains unknown identity evidence`);
    }
}

function validateArkanalyzerMethodKey(methodKey, where, failures) {
    if (!isPlainObject(methodKey)) {
        failures.push(`${where}.evidence.arkanalyzer.methodKey is required for invoke/construct surface`);
        return;
    }
    for (const key of ["declaringFileName", "declaringClassName", "methodName", "returnType"]) {
        if (typeof methodKey[key] !== "string" || methodKey[key].trim() === "") {
            failures.push(`${where}.evidence.arkanalyzer.methodKey.${key} must be a stable string`);
        }
        if (String(methodKey[key] || "").includes("%unk") || String(methodKey[key] || "").includes("@unk")) {
            failures.push(`${where}.evidence.arkanalyzer.methodKey.${key} contains unknown identity evidence`);
        }
    }
    if (!Array.isArray(methodKey.parameterTypes)) {
        failures.push(`${where}.evidence.arkanalyzer.methodKey.parameterTypes must be an array`);
    }
    if (typeof methodKey.staticFlag !== "boolean") {
        failures.push(`${where}.evidence.arkanalyzer.methodKey.staticFlag must be boolean`);
    }
}

function validateRoleTemplateCompatibility(role, template, where, failures) {
    const expectedRuleKind = RULE_TEMPLATE_KIND_BY_ROLE[role];
    if (expectedRuleKind && template.kind !== expectedRuleKind) {
        failures.push(`${where} expected ${expectedRuleKind}, got ${template.kind}`);
        return;
    }
    if ((role === "handoff" || role === "module" || role === "callback-registration")
        && !String(template.kind || "").startsWith("handoff.")
        && template.kind !== "module.eventEmitter"
        && template.kind !== "core.capability") {
        failures.push(`${where} expected module template, got ${template.kind}`);
    }
    if ((role === "entry" || role === "arkmain")
        && !String(template.kind || "").startsWith("entry.")
        && template.kind !== "core.capability") {
        failures.push(`${where} expected arkmain template, got ${template.kind}`);
    }
}

function validateBindingEndpointRequirement(binding, where, failures) {
    if (binding.role === "source" || binding.role === "sink" || binding.role === "sanitizer") {
        if (!isEndpointLike(binding.endpoint)) {
            failures.push(`${where}.endpoint is required for ${binding.role}`);
        }
    }
}

function validateTemplateNoUnknowns(template, where, failures) {
    walk(template, where, (value, currentPath, key) => {
        if (key === "kind" && value === "unknown") {
            failures.push(`${currentPath} must not use unknown handle kind`);
        }
        if ((key === "precision" || key === "confidence" || key === "strength" || key === "completeness") && value === "unknown") {
            failures.push(`${currentPath} must not be unknown in official kernel assets`);
        }
    });
}

function validateRemovedInternalCatalog(file, failures) {
    if (fs.existsSync(abs(file))) {
        failures.push({
            file,
            failures: ["legacy internal arkmain catalog must be deleted; official declarations are the only arkmain identity asset"],
        });
    }
}

function walkForbiddenAssetKeys(value, currentPath, failures) {
    walk(value, currentPath, (nodeValue, nodePath, key) => {
        if (!FORBIDDEN_ASSET_KEYS.has(key)) return;
        if (isArkanalyzerMethodKeyPath(nodePath)) return;
        failures.push(`${nodePath} is a forbidden legacy field`);
    });
}

function isArkanalyzerMethodKeyPath(currentPath) {
    return /\.surfaces\[\d+\]\.evidence\.arkanalyzer\.methodKey\./.test(currentPath);
}

function createDescriptorMap(assets) {
    const descriptors = new Map();
    for (const asset of assets) {
        for (const surface of arrayOf(asset && asset.surfaces)) {
            const canonicalApiId = surface && surface.canonicalApiId;
            if (typeof canonicalApiId !== "string" || canonicalApiId.trim() === "") continue;
            if (descriptors.has(canonicalApiId)) continue;
            descriptors.set(canonicalApiId, canonicalApiDescriptorFromIdSeed({ canonicalApiId }));
        }
    }
    return descriptors;
}

function isEndpointLike(value) {
    return isPlainObject(value) && isPlainObject(value.base) && typeof value.base.kind === "string";
}

function walk(value, currentPath, visitor) {
    if (Array.isArray(value)) {
        value.forEach((item, index) => walk(item, `${currentPath}[${index}]`, visitor));
        return;
    }
    if (!isPlainObject(value)) return;
    for (const [key, child] of Object.entries(value)) {
        const childPath = `${currentPath}.${key}`;
        visitor(child, childPath, key);
        walk(child, childPath, visitor);
    }
}

function listFiles(relativeDir, extension) {
    const dir = abs(relativeDir);
    if (!fs.existsSync(dir)) return [];
    const output = [];
    for (const name of fs.readdirSync(dir).sort((left, right) => left.localeCompare(right))) {
        const file = path.join(dir, name);
        const stat = fs.statSync(file);
        if (stat.isDirectory()) {
            output.push(...listFiles(path.relative(ROOT, file), extension));
        } else if (file.endsWith(extension)) {
            output.push(path.relative(ROOT, file).split(path.sep).join("/"));
        }
    }
    return output;
}

function readJson(file) {
    return JSON.parse(fs.readFileSync(abs(file), "utf8").replace(/^\uFEFF/, ""));
}

function abs(file) {
    return path.resolve(ROOT, file);
}

function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function arrayOf(value) {
    return Array.isArray(value) ? value : [];
}

function isAssetDocumentLike(value) {
    return isPlainObject(value)
        && typeof value.id === "string"
        && (value.plane === "rule" || value.plane === "module" || value.plane === "arkmain")
        && Array.isArray(value.surfaces)
        && Array.isArray(value.bindings);
}

main();
