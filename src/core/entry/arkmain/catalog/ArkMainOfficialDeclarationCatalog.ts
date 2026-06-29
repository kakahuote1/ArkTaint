import * as fs from "fs";
import * as path from "path";
import type { AssetBinding, AssetDocumentBase, EntryLifecycleTemplate, EntrySurface, InvokeSurface } from "../../../assets/schema";
import {
    arkanalyzerMethodKeyString,
    isKnownArkanalyzerMethodKey,
    type ArkanalyzerMethodKey,
} from "../../../api/identity";

type ArkMainOfficialSurface = EntrySurface | InvokeSurface;

export interface ArkMainOfficialLifecycleDeclaration {
    assetId: string;
    canonicalApiId: string;
    surfaceId: string;
    bindingId: string;
    templateId: string;
    methodKey: ArkanalyzerMethodKey;
    phase: string;
    entryKind: string;
    ownerKind?: string;
    entryShape?: string;
    entryFamily?: string;
}

let cachedDeclarations: ArkMainOfficialLifecycleDeclaration[] | undefined;
let cachedByMethodKey: Map<string, ArkMainOfficialLifecycleDeclaration[]> | undefined;
let cachedByOwnerKindAndMethod: Map<string, ArkMainOfficialLifecycleDeclaration[]> | undefined;

export function loadArkMainOfficialLifecycleDeclarations(): ArkMainOfficialLifecycleDeclaration[] {
    if (!cachedDeclarations) {
        cachedDeclarations = readArkMainOfficialLifecycleDeclarations(resolveOfficialDeclarationCatalogPath());
    }
    return cachedDeclarations.map(item => ({
        ...item,
        methodKey: cloneMethodKey(item.methodKey),
    }));
}

export function resolveArkMainOfficialLifecycleDeclarationsByMethodKey(
    methodKey: ArkanalyzerMethodKey | undefined,
): ArkMainOfficialLifecycleDeclaration[] {
    if (!methodKey || !isKnownArkanalyzerMethodKey(methodKey)) {
        return [];
    }
    if (!cachedByMethodKey) {
        cachedByMethodKey = new Map();
        for (const declaration of loadArkMainOfficialLifecycleDeclarations()) {
            const key = arkanalyzerMethodKeyString(declaration.methodKey);
            const bucket = cachedByMethodKey.get(key) || [];
            bucket.push(declaration);
            cachedByMethodKey.set(key, bucket);
        }
    }
    return (cachedByMethodKey.get(arkanalyzerMethodKeyString(methodKey)) || [])
        .map(item => ({
            ...item,
            methodKey: cloneMethodKey(item.methodKey),
        }));
}

export function hasArkMainOfficialDeclarationForOwnerKindAndMethod(
    ownerKind: string,
    methodName: string,
): boolean {
    return resolveArkMainOfficialLifecycleDeclarationsByOwnerKindAndMethod(ownerKind, methodName).length > 0;
}

export function hasArkMainOfficialComponentDeclarationForMethod(methodName: string): boolean {
    return hasArkMainOfficialDeclarationForOwnerKindAndMethod("component_owner", methodName)
        || hasArkMainOfficialDeclarationForOwnerKindAndMethod("builder_owner", methodName);
}

export function hasExactArkMainOfficialLifecycleDeclarationForFact(fact: {
    canonicalApiId?: string;
    semanticSurfaceId?: string;
    semanticBindingId?: string;
    semanticTemplateId?: string;
    phase?: string;
    kind?: string;
    ownerKind?: string;
    entryShape?: string;
    entryFamily?: string;
}): boolean {
    const canonicalApiId = stableString(fact.canonicalApiId);
    const surfaceId = stableString(fact.semanticSurfaceId);
    const bindingId = stableString(fact.semanticBindingId);
    const templateId = stableString(fact.semanticTemplateId);
    if (!canonicalApiId || !surfaceId || !bindingId || !templateId) {
        return false;
    }
    return loadArkMainOfficialLifecycleDeclarations().some(declaration =>
        declaration.canonicalApiId === canonicalApiId
        && declaration.surfaceId === surfaceId
        && declaration.bindingId === bindingId
        && declaration.templateId === templateId
        && declaration.phase === stableString(fact.phase)
        && declaration.entryKind === stableString(fact.kind)
        && declaration.ownerKind === stableString(fact.ownerKind)
        && declaration.entryShape === stableString(fact.entryShape)
        && declaration.entryFamily === stableString(fact.entryFamily),
    );
}

export function resolveArkMainOfficialLifecycleDeclarationsByOwnerKindAndMethod(
    ownerKind: string,
    methodName: string,
): ArkMainOfficialLifecycleDeclaration[] {
    const key = ownerMethodKey(ownerKind, methodName);
    return (getByOwnerKindAndMethod().get(key) || [])
        .map(item => ({
            ...item,
            methodKey: cloneMethodKey(item.methodKey),
        }));
}

export function resolveArkMainOfficialLifecycleDeclarationsByClassNameAndMethod(
    className: string | undefined,
    methodName: string | undefined,
): ArkMainOfficialLifecycleDeclaration[] {
    const normalizedClassName = stableString(className);
    const normalizedMethodName = stableString(methodName);
    if (!normalizedClassName || !normalizedMethodName) {
        return [];
    }
    return loadArkMainOfficialLifecycleDeclarations()
        .filter(declaration =>
            declaration.methodKey.declaringClassName === normalizedClassName
            && declaration.methodKey.methodName === normalizedMethodName,
        )
        .map(item => ({
            ...item,
            methodKey: cloneMethodKey(item.methodKey),
        }));
}

export function resolveArkMainOfficialRuntimeOwnerKindByClassName(
    className: string | undefined,
): "ability_owner" | "stage_owner" | "extension_owner" | "child_process_owner" | undefined {
    const normalizedClassName = stableString(className);
    if (!normalizedClassName) {
        return undefined;
    }
    const ownerKinds = new Set<"ability_owner" | "stage_owner" | "extension_owner" | "child_process_owner">();
    for (const declaration of loadArkMainOfficialLifecycleDeclarations()) {
        if (declaration.methodKey.declaringClassName !== normalizedClassName) {
            continue;
        }
        switch (declaration.ownerKind) {
            case "ability_owner":
            case "stage_owner":
            case "extension_owner":
            case "child_process_owner":
                ownerKinds.add(declaration.ownerKind);
                break;
            default:
                break;
        }
    }
    return ownerKinds.size === 1 ? [...ownerKinds][0] : undefined;
}

export function resolveOfficialDeclarationCatalogPath(): string {
    const candidates = [
        path.resolve(__dirname, "../../../../../src/models/kernel/arkmain/harmony/official_declarations.catalog.json"),
        path.resolve(process.cwd(), "src", "models", "kernel", "arkmain", "harmony", "official_declarations.catalog.json"),
    ];
    for (const candidate of candidates) {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
            return candidate;
        }
    }
    return candidates[0];
}

function readArkMainOfficialLifecycleDeclarations(assetPath: string): ArkMainOfficialLifecycleDeclaration[] {
    const asset = JSON.parse(fs.readFileSync(assetPath, "utf8")) as AssetDocumentBase;
    const errors: string[] = [];
    if (!asset || typeof asset !== "object" || Array.isArray(asset)) {
        throw new Error(`${assetPath} must contain an arkmain official declaration asset object`);
    }
    if (asset.plane !== "arkmain") {
        errors.push(`${assetPath}.plane must be arkmain`);
    }
    if (asset.status !== "official") {
        errors.push(`${assetPath}.status must be official`);
    }
    if (!Array.isArray(asset.surfaces)) {
        errors.push(`${assetPath}.surfaces must be an array`);
    }
    if (!Array.isArray(asset.bindings)) {
        errors.push(`${assetPath}.bindings must be an array`);
    }
    const templates = Array.isArray(asset.effectTemplates) ? asset.effectTemplates : [];
    const surfacesById = new Map<string, ArkMainOfficialSurface>();
    for (const [index, surface] of (asset.surfaces || []).entries()) {
        if (!surface || typeof surface !== "object") {
            errors.push(`${assetPath}.surfaces[${index}] must be an object`);
            continue;
        }
        if (surface.kind !== "entry" && surface.kind !== "invoke") {
            continue;
        }
        const surfaceId = stableString((surface as any).surfaceId);
        if (!surfaceId) {
            errors.push(`${assetPath}.surfaces[${index}].surfaceId must be a non-empty string`);
            continue;
        }
        surfacesById.set(surfaceId, surface as ArkMainOfficialSurface);
    }

    const lifecycleTemplatesById = new Map<string, EntryLifecycleTemplate>();
    for (const [index, template] of templates.entries()) {
        if (!template || typeof template !== "object" || Array.isArray(template)) {
            errors.push(`${assetPath}.effectTemplates[${index}] must be an object`);
            continue;
        }
        if ((template as any).kind !== "entry.lifecycle") {
            continue;
        }
        const id = stableString((template as any).id);
        if (!id) {
            errors.push(`${assetPath}.effectTemplates[${index}].id must be a non-empty string`);
            continue;
        }
        lifecycleTemplatesById.set(id, template as EntryLifecycleTemplate);
    }

    const declarations: ArkMainOfficialLifecycleDeclaration[] = [];
    for (const [index, binding] of (asset.bindings || []).entries()) {
        if (!isArkMainEntryBinding(binding)) {
            continue;
        }
        const bindingId = stableString(binding.bindingId);
        if (!bindingId) {
            errors.push(`${assetPath}.bindings[${index}].bindingId must be a non-empty string`);
            continue;
        }
        const surface = surfacesById.get(binding.surfaceId);
        if (!surface) {
            errors.push(`${assetPath}.bindings[${index}] references missing official surface ${binding.surfaceId}`);
            continue;
        }
        const canonicalApiId = stableString(binding.canonicalApiId);
        if (!canonicalApiId || canonicalApiId !== stableString(surface.canonicalApiId)) {
            errors.push(`${assetPath}.bindings[${index}].canonicalApiId must match its official surface`);
            continue;
        }
        const methodKey = methodKeyFromOfficialSurface(surface);
        if (!methodKey || !isKnownArkanalyzerMethodKey(methodKey)) {
            errors.push(`${assetPath}.bindings[${index}] ${canonicalApiId} is missing exact known Arkanalyzer methodKey evidence`);
            continue;
        }
        for (const ref of binding.effectTemplateRefs || []) {
            const template = lifecycleTemplatesById.get(ref);
            if (!template) {
                continue;
            }
            declarations.push({
                assetId: asset.id,
                canonicalApiId,
                surfaceId: surface.surfaceId,
                bindingId,
                templateId: template.id,
                methodKey,
                phase: String(template.phase || "").trim(),
                entryKind: String(template.entryKind || "").trim(),
                ownerKind: stableString(template.ownerKind),
                entryShape: stableString(template.entryShape),
                entryFamily: stableString(binding.semanticsFamily) || stableString(template.entryKind),
            });
        }
    }
    if (errors.length > 0) {
        throw new Error(`invalid arkmain official declaration catalog ${assetPath}: ${errors.join("; ")}`);
    }
    return declarations.sort((left, right) =>
        left.canonicalApiId.localeCompare(right.canonicalApiId)
        || left.bindingId.localeCompare(right.bindingId)
        || left.templateId.localeCompare(right.templateId),
    );
}

function getByOwnerKindAndMethod(): Map<string, ArkMainOfficialLifecycleDeclaration[]> {
    if (!cachedByOwnerKindAndMethod) {
        cachedByOwnerKindAndMethod = new Map();
        for (const declaration of loadArkMainOfficialLifecycleDeclarations()) {
            const methodName = stableString(declaration.methodKey.methodName);
            if (!methodName) continue;
            for (const ownerKind of ownerKindsForDeclaration(declaration)) {
                const key = ownerMethodKey(ownerKind, methodName);
                const bucket = cachedByOwnerKindAndMethod.get(key) || [];
                bucket.push(declaration);
                cachedByOwnerKindAndMethod.set(key, bucket);
            }
        }
    }
    return cachedByOwnerKindAndMethod;
}

function ownerMethodKey(ownerKind: string, methodName: string): string {
    return `${String(ownerKind || "").trim()}#${String(methodName || "").trim()}`;
}

function ownerKindsForDeclaration(declaration: ArkMainOfficialLifecycleDeclaration): string[] {
    const out = new Set<string>();
    const declared = stableString(declaration.ownerKind);
    const normalizedDeclared = normalizedOwnerKind(declared);
    if (normalizedDeclared) {
        out.add(normalizedDeclared);
    }
    return [...out.values()];
}

function normalizedOwnerKind(value: string | undefined): string | undefined {
    switch (value) {
        case "ability_owner":
        case "stage_owner":
        case "extension_owner":
        case "child_process_owner":
        case "component_owner":
        case "builder_owner":
        case "unknown_owner":
            return value;
        default:
            return undefined;
    }
}

function isArkMainEntryBinding(value: unknown): value is AssetBinding {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return false;
    }
    const binding = value as AssetBinding;
    return binding.plane === "arkmain"
        && binding.role === "entry"
        && Array.isArray(binding.effectTemplateRefs);
}

function methodKeyFromOfficialSurface(surface: ArkMainOfficialSurface): ArkanalyzerMethodKey | undefined {
    const raw = (surface as any).evidence?.arkanalyzer?.methodKey;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return undefined;
    }
    const key: ArkanalyzerMethodKey = {
        declaringFileName: String(raw.declaringFileName || "").trim(),
        declaringNamespacePath: Array.isArray(raw.declaringNamespacePath)
            ? raw.declaringNamespacePath.map((item: unknown) => String(item || "").trim()).filter(Boolean)
            : [],
        declaringClassName: String(raw.declaringClassName || "").trim(),
        methodName: String(raw.methodName || "").trim(),
        parameterTypes: Array.isArray(raw.parameterTypes)
            ? raw.parameterTypes.map((item: unknown) => String(item || "").trim())
            : [],
        returnType: String(raw.returnType || "").trim(),
        staticFlag: raw.staticFlag === true,
    };
    return key.declaringFileName
        && key.declaringClassName
        && key.methodName
        && key.returnType
        ? key
        : undefined;
}

function cloneMethodKey(key: ArkanalyzerMethodKey): ArkanalyzerMethodKey {
    return {
        ...key,
        declaringNamespacePath: [...(key.declaringNamespacePath || [])],
        parameterTypes: [...(key.parameterTypes || [])],
    };
}

function stableString(value: unknown): string | undefined {
    const text = String(value || "").trim();
    return text.length > 0 ? text : undefined;
}
