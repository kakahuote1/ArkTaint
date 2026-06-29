import { ArkAssignStmt } from "../../../../../arkanalyzer/out/src/core/base/Stmt";
import { ArkInstanceFieldRef } from "../../../../../arkanalyzer/out/src/core/base/Ref";
import { ArkClass } from "../../../../../arkanalyzer/out/src/core/model/ArkClass";
import { ArkMethod } from "../../../../../arkanalyzer/out/src/core/model/ArkMethod";
import { ArkMainEntryFact } from "../ArkMainTypes";
import {
    hasArkMainOfficialComponentDeclarationForMethod,
    resolveArkMainOfficialLifecycleDeclarationsByMethodKey,
    resolveArkMainOfficialRuntimeOwnerKindByClassName,
} from "../catalog/ArkMainOfficialDeclarationCatalog";
import { arkanalyzerMethodKeyFromArkMethod } from "./ArkMainArkanalyzerMethodKey";
import type { Scene } from "../../../../../arkanalyzer/out/src/Scene";

export function classInheritsAbility(arkClass: ArkClass): boolean {
    return !!resolveAbilityLikeOwnerKind(arkClass);
}

export function resolveAbilityLikeOwnerKind(
    arkClass: ArkClass,
    scene?: Scene,
): "ability_owner" | "stage_owner" | "extension_owner" | "child_process_owner" | undefined {
    const directKind = resolveOfficialAbilityOwnerKindFromSdkClass(safeGetSuperClass(arkClass), scene);
    if (directKind) {
        return directKind;
    }
    let resolved: "ability_owner" | "stage_owner" | "extension_owner" | "child_process_owner" | undefined;
    walkArkMainSuperClasses(arkClass, superClass => {
        const officialKind = resolveOfficialAbilityOwnerKindFromSdkClass(superClass, scene);
        if (officialKind) {
            resolved = officialKind;
            return false;
        }
        return true;
    });
    return resolved;
}

export const ARK_MAIN_MAX_SUPERCLASS_DEPTH = 64;

export function getArkMainClassIdentity(cls: ArkClass | null | undefined): string | undefined {
    if (!cls) return undefined;
    try {
        const signatureText = cls.getSignature?.()?.toString?.();
        if (signatureText) return signatureText;
    } catch {
        // Some real projects trigger arkanalyzer class-resolution recursion here.
    }
    let fileSignatureText = "";
    try {
        fileSignatureText = cls.getDeclaringArkFile?.()?.getFileSignature?.()?.toString?.()
            || cls.getSignature?.()?.getDeclaringFileSignature?.()?.toString?.()
            || "";
    } catch {
        fileSignatureText = "";
    }
    const className = safeGetClassName(cls) || "";
    if (!className) return undefined;
    return `${fileSignatureText}::${className}`;
}

export function walkArkMainSuperClasses(
    arkClass: ArkClass | null | undefined,
    visit: (superClass: ArkClass) => boolean | void,
    maxDepth: number = ARK_MAIN_MAX_SUPERCLASS_DEPTH,
): void {
    const visitedObjects = new WeakSet<object>();
    const visitedIdentities = new Set<string>();
    let superClass = safeGetSuperClass(arkClass);
    let depth = 0;
    while (superClass && depth < maxDepth) {
        const objectRef = typeof superClass === "object" ? superClass as object : undefined;
        if (objectRef) {
            if (visitedObjects.has(objectRef)) {
                break;
            }
            visitedObjects.add(objectRef);
        }
        const identity = getArkMainClassIdentity(superClass);
        if (identity) {
            if (visitedIdentities.has(identity)) {
                break;
            }
            visitedIdentities.add(identity);
        }
        if (visit(superClass) === false) {
            break;
        }
        const nextSuperClass = safeGetSuperClass(superClass);
        if (!nextSuperClass || nextSuperClass === superClass) {
            break;
        }
        superClass = nextSuperClass;
        depth += 1;
    }
}

export function safeGetSuperClass(cls: ArkClass | null | undefined): ArkClass | undefined {
    try {
        return cls?.getSuperClass?.() || undefined;
    } catch {
        return undefined;
    }
}

export function safeGetClassName(cls: ArkClass | null | undefined): string | undefined {
    try {
        return cls?.getName?.() || undefined;
    } catch {
        return undefined;
    }
}

export function safeGetSuperClassName(cls: ArkClass | null | undefined): string | undefined {
    try {
        return cls?.getSuperClassName?.() || undefined;
    } catch {
        return undefined;
    }
}

export function dedupeMethods(methods: ArkMethod[]): ArkMethod[] {
    const out = new Map<string, ArkMethod>();
    for (const method of methods) {
        const signature = method?.getSignature?.()?.toString?.();
        if (!signature || out.has(signature)) continue;
        out.set(signature, method);
    }
    return [...out.values()];
}

export function normalizeDecoratorKind(raw: string | undefined): string | undefined {
    if (!raw) return undefined;
    const normalized = raw.replace(/^@/, "").trim();
    if (!normalized) return undefined;
    return normalized.endsWith("()")
        ? normalized.slice(0, normalized.length - 2)
        : normalized;
}

export function findReactiveAnchorMethod(cls: ArkClass): ArkMethod | undefined {
    return findReactiveAnchorMethods(cls)[0];
}

export function findReactiveAnchorMethods(cls: ArkClass): ArkMethod[] {
    const methods = cls.getMethods().filter(method => !method.isStatic());
    return dedupeMethods(methods.filter(method =>
        hasArkMainOfficialComponentDeclarationForMethod(method.getName?.() || ""),
    ));
}

export function collectWatchedFieldWritesFromMethods(
    methods: ArkMethod[],
    watchedFields: Set<string>,
): string[] {
    const writtenFields = new Set<string>();
    for (const method of methods) {
        for (const fieldName of collectThisFieldWrites(method, watchedFields)) {
            writtenFields.add(fieldName);
        }
    }
    return [...writtenFields.values()].sort((a, b) => a.localeCompare(b));
}

export function collectDecoratedFieldNames(cls: ArkClass, decoratorKinds: Set<string>): string[] {
    const out = new Set<string>();
    for (const field of cls.getFields()) {
        for (const decorator of field.getDecorators?.() || []) {
            const kind = normalizeDecoratorKind(decorator?.getKind?.());
            if (kind && decoratorKinds.has(kind)) {
                out.add(field.getName());
            }
        }
    }
    return [...out.values()].sort((a, b) => a.localeCompare(b));
}

export function isOfficialArkMainWatchDecoratorKind(_kind: string | undefined): boolean {
    return false;
}

export function extractWatchTargets(decorators: any[]): string[] {
    const out = new Set<string>();
    for (const decorator of decorators) {
        const kind = normalizeDecoratorKind(decorator?.getKind?.());
        if (!isOfficialArkMainWatchDecoratorKind(kind)) continue;
        const raw = decorator?.getParam?.() || decorator?.getContent?.() || "";
        const normalized = normalizeDecoratorParam(raw);
        if (normalized) out.add(normalized);
    }
    return [...out.values()].sort((a, b) => a.localeCompare(b));
}

export function collectClassWatchTargets(facts: ArkMainEntryFact[], cls: ArkClass): string[] {
    const targets = new Set<string>();
    for (const fact of facts) {
        if (fact.kind !== "watch_handler") continue;
        if (fact.method.getDeclaringArkClass?.()?.getName?.() !== cls.getName?.()) continue;
        for (const target of fact.watchTargets || []) {
            targets.add(target);
        }
    }
    return [...targets.values()].sort((a, b) => a.localeCompare(b));
}

export function collectThisFieldWrites(method: ArkMethod, watchedFields: Set<string>): string[] {
    const cfg = method.getCfg?.();
    if (!cfg) return [];
    const out = new Set<string>();
    for (const stmt of cfg.getStmts()) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        const left = stmt.getLeftOp();
        if (!(left instanceof ArkInstanceFieldRef)) continue;
        const baseName = left.getBase?.()?.getName?.();
        if (baseName !== "this") continue;
        const fieldName = left.getFieldName?.() || left.getFieldSignature?.()?.getFieldName?.();
        if (!fieldName || !watchedFields.has(fieldName)) continue;
        out.add(fieldName);
    }
    return [...out.values()].sort((a, b) => a.localeCompare(b));
}

function resolveOfficialAbilityOwnerKindFromSdkClass(
    sdkClass: ArkClass | null | undefined,
    scene?: Scene,
): "ability_owner" | "stage_owner" | "extension_owner" | "child_process_owner" | undefined {
    for (const method of sdkClass?.getMethods?.() || []) {
        const methodKey = arkanalyzerMethodKeyFromArkMethod(method);
        if (!methodKey) {
            continue;
        }
        for (const declaration of resolveArkMainOfficialLifecycleDeclarationsByMethodKey(methodKey)) {
            switch (declaration.ownerKind) {
                case "ability_owner":
                case "stage_owner":
                case "extension_owner":
                case "child_process_owner":
                    return declaration.ownerKind;
                default:
                    break;
            }
        }
    }
    if (scene && isSdkBackedArkMainClass(scene, sdkClass)) {
        return resolveArkMainOfficialRuntimeOwnerKindByClassName(safeGetClassName(sdkClass));
    }
    return undefined;
}

function isSdkBackedArkMainClass(scene: Scene, arkClass: ArkClass | null | undefined): boolean {
    try {
        const fileSig = arkClass?.getDeclaringArkFile?.()?.getFileSignature?.();
        return !!fileSig && scene.hasSdkFile(fileSig);
    } catch {
        return false;
    }
}

function normalizeDecoratorParam(raw: string): string | undefined {
    const text = String(raw || "").trim();
    if (!text) return undefined;
    const quoted = text.match(/^["'`](.+)["'`]$/);
    if (quoted) return quoted[1];
    const contentMatch = text.match(/\(\s*['"`]([^'"`]+)['"`]\s*\)/);
    if (contentMatch) return contentMatch[1];
    return text;
}


