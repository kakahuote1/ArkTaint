import * as fs from "fs";
import * as path from "path";

interface CatalogSurface {
    surfaceId: string;
    canonicalApiId: string;
    kind: string;
    evidence?: {
        arkanalyzer?: {
            methodKey?: {
                declaringFileName: string;
                declaringNamespacePath: string[];
                declaringClassName: string;
                methodName: string;
                parameterTypes: string[];
                returnType: string;
                staticFlag: boolean;
            };
        };
    };
}

interface CatalogBinding {
    bindingId: string;
    surfaceId: string;
    canonicalApiId: string;
    assetId: string;
    plane: string;
    role: string;
    effectTemplateRefs: string[];
    semanticsFamily?: string;
}

interface CatalogTemplate {
    id: string;
    kind: string;
    entryKind: string;
    phase: string;
    ownerKind: string;
    entryShape: string;
}

interface CatalogAsset {
    id: string;
    plane: string;
    status: string;
    surfaces: CatalogSurface[];
    bindings: CatalogBinding[];
    effectTemplates: CatalogTemplate[];
}

interface ExpectedEntry {
    className: string;
    methodName: string;
    parameterTypes: string[];
    returnType: string;
    entryKind: string;
    phase: string;
    ownerKind: string;
    entryShape: string;
    semanticsFamily: string;
}

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

function main(): void {
    const catalog = readCatalog();
    assert(catalog.id === "arkmain.harmony.official_declarations", "unexpected arkmain official catalog id");
    assert(catalog.plane === "arkmain", "arkmain official catalog must use plane=arkmain");
    assert(catalog.status === "official", "arkmain official catalog must be official");

    const expectedEntries: ExpectedEntry[] = [
        {
            className: "UIAbility",
            methodName: "onDestroy",
            parameterTypes: [],
            returnType: "void",
            entryKind: "ability_lifecycle",
            phase: "teardown",
            ownerKind: "ability_owner",
            entryShape: "override_slot",
            semanticsFamily: "ability_lifecycle",
        },
        {
            className: "AbilityStage",
            methodName: "onDestroy",
            parameterTypes: [],
            returnType: "void",
            entryKind: "stage_lifecycle",
            phase: "teardown",
            ownerKind: "stage_owner",
            entryShape: "override_slot",
            semanticsFamily: "stage_lifecycle",
        },
        {
            className: "BaseCustomComponent",
            methodName: "build",
            parameterTypes: [],
            returnType: "void",
            entryKind: "page_build",
            phase: "composition",
            ownerKind: "component_owner",
            entryShape: "declaration_owner_slot",
            semanticsFamily: "page_build",
        },
        {
            className: "UIAbility",
            methodName: "onWindowStageCreate",
            parameterTypes: ["window.WindowStage"],
            returnType: "void",
            entryKind: "ability_lifecycle",
            phase: "bootstrap",
            ownerKind: "ability_owner",
            entryShape: "override_slot",
            semanticsFamily: "ability_lifecycle",
        },
        {
            className: "FormExtensionAbility",
            methodName: "onUpdateForm",
            parameterTypes: ["string", "Record<string, Object>"],
            returnType: "void",
            entryKind: "extension_lifecycle",
            phase: "interaction",
            ownerKind: "extension_owner",
            entryShape: "override_slot",
            semanticsFamily: "extension_lifecycle",
        },
        {
            className: "ChildProcess",
            methodName: "onStart",
            parameterTypes: ["ChildProcessArgs"],
            returnType: "void",
            entryKind: "process_lifecycle",
            phase: "bootstrap",
            ownerKind: "child_process_owner",
            entryShape: "override_slot",
            semanticsFamily: "process_lifecycle",
        },
    ];

    for (const expected of expectedEntries) {
        assertCurrentCatalogEntry(catalog, expected);
    }

    console.log(`PASS test_arkmain_lifecycle_contract_catalog currentCatalogEntries=${expectedEntries.length}`);
}

function assertCurrentCatalogEntry(catalog: CatalogAsset, expected: ExpectedEntry): void {
    const surface = catalog.surfaces.find(item => {
        const key = item.evidence?.arkanalyzer?.methodKey;
        return key?.declaringClassName === expected.className
            && key.methodName === expected.methodName
            && JSON.stringify(key.parameterTypes || []) === JSON.stringify(expected.parameterTypes)
            && key.returnType === expected.returnType;
    });
    assert(surface, `missing official surface ${expected.className}.${expected.methodName}`);
    assert(surface.kind === "invoke", `${surface.surfaceId} must be an invoke surface`);
    assert(surface.canonicalApiId?.startsWith("api:official:"), `${surface.surfaceId} must carry official canonicalApiId`);

    const binding = catalog.bindings.find(item => item.surfaceId === surface.surfaceId);
    assert(binding, `missing binding for ${surface.surfaceId}`);
    assert(binding.plane === "arkmain", `${binding.bindingId} must use plane=arkmain`);
    assert(binding.role === "entry", `${binding.bindingId} must use role=entry`);
    assert(binding.assetId === catalog.id, `${binding.bindingId} assetId must match catalog`);
    assert(binding.canonicalApiId === surface.canonicalApiId, `${binding.bindingId} canonicalApiId must match surface`);
    assert(Array.isArray(binding.effectTemplateRefs) && binding.effectTemplateRefs.length === 1, `${binding.bindingId} must reference exactly one entry template`);

    const template = catalog.effectTemplates.find(item => item.id === binding.effectTemplateRefs[0]);
    assert(template, `missing template ${binding.effectTemplateRefs[0]}`);
    assert(template.kind === "entry.lifecycle", `${template.id} must use current entry.lifecycle template kind`);
    assert(template.entryKind === expected.entryKind, `${template.id} entryKind mismatch: ${template.entryKind}`);
    assert(template.phase === expected.phase, `${template.id} phase mismatch: ${template.phase}`);
    assert(template.ownerKind === expected.ownerKind, `${template.id} ownerKind mismatch: ${template.ownerKind}`);
    assert(template.entryShape === expected.entryShape, `${template.id} entryShape mismatch: ${template.entryShape}`);
    assert(binding.semanticsFamily === expected.semanticsFamily, `${binding.bindingId} semanticsFamily mismatch: ${binding.semanticsFamily}`);
}

function readCatalog(): CatalogAsset {
    const file = path.resolve("src/models/kernel/arkmain/harmony/official_declarations.catalog.json");
    return JSON.parse(fs.readFileSync(file, "utf8")) as CatalogAsset;
}

main();
