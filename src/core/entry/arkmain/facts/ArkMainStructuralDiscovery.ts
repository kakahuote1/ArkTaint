import { Scene } from "../../../../../arkanalyzer/out/src/Scene";
import { ArkField } from "../../../../../arkanalyzer/out/src/core/model/ArkField";
import { ArkClass } from "../../../../../arkanalyzer/out/src/core/model/ArkClass";
import { ArkMethod } from "../../../../../arkanalyzer/out/src/core/model/ArkMethod";
import { ModifierType } from "../../../../../arkanalyzer/out/src/core/model/ArkBaseModel";
import { CONSTRUCTOR_NAME } from "../../../../../arkanalyzer/out/src/core/common/TSConst";
import { safeGetSuperClassName, walkArkMainSuperClasses } from "./ArkMainFactResolverUtils";

export interface ArkMainSdkOverrideCandidate {
    method: ArkMethod;
    baseClass?: ArkClass;
    baseMethod?: ArkMethod;
    discoveryLayer: "sdk_override_first_layer";
    explicitOverride: boolean;
}

export type ArkMainDecoratorTargetKind = "class" | "method" | "field";

export interface ArkMainDecoratorCandidate {
    ownerClass: ArkClass;
    targetKind: ArkMainDecoratorTargetKind;
    targetName: string;
    decoratorKinds: string[];
    discoveryLayer: "qualified_decorator_first_layer";
    ownerQualification: "component_owner";
}

export function isSdkBackedArkClass(scene: Scene, arkClass: ArkClass | null | undefined): boolean {
    try {
        const fileSig = arkClass?.getDeclaringArkFile?.()?.getFileSignature?.();
        return !!fileSig && scene.hasSdkFile(fileSig);
    } catch {
        return false;
    }
}

export function resolveSdkOverrideCandidate(
    scene: Scene,
    method: ArkMethod,
): ArkMainSdkOverrideCandidate | undefined {
    if (!isEligibleOverrideMethod(method)) {
        return undefined;
    }

    const explicitOverride = method.containsModifier?.(ModifierType.OVERRIDE) ?? false;
    let resolved: ArkMainSdkOverrideCandidate | undefined;
    walkArkMainSuperClasses(method.getDeclaringArkClass?.(), superClass => {
        if (isSdkBackedArkClass(scene, superClass)) {
            const baseMethod = findSdkBaseMethod(superClass, method.getName());
            if (baseMethod) {
                resolved = {
                    method,
                    baseClass: superClass,
                    baseMethod,
                    discoveryLayer: "sdk_override_first_layer",
                    explicitOverride,
                };
                return false;
            }
        }
        return true;
    });
    if (resolved) {
        return resolved;
    }
    if (explicitOverride && hasSdkImportedSuperclassReference(method.getDeclaringArkClass?.())) {
        return {
            method,
            discoveryLayer: "sdk_override_first_layer",
            explicitOverride,
        };
    }
    return undefined;
}

export function collectSdkOverrideCandidates(scene: Scene, classes: ArkClass[] = scene.getClasses()): ArkMainSdkOverrideCandidate[] {
    const candidates: ArkMainSdkOverrideCandidate[] = [];
    const seen = new Set<string>();
    for (const cls of classes) {
        for (const method of getInstanceMethods(cls)) {
            const candidate = resolveSdkOverrideCandidate(scene, method);
            const signature = candidate?.method.getSignature?.().toString?.();
            if (!candidate || !signature || seen.has(signature)) {
                continue;
            }
            seen.add(signature);
            candidates.push(candidate);
        }
    }
    return candidates;
}

export function isQualifiedDecoratorOwner(arkClass: ArkClass): boolean {
    return arkClass.hasEntryDecorator?.() || arkClass.hasComponentDecorator?.() || false;
}

export function collectQualifiedDecoratorCandidates(classes: ArkClass[]): ArkMainDecoratorCandidate[] {
    const candidates: ArkMainDecoratorCandidate[] = [];
    for (const cls of classes) {
        if (!isQualifiedDecoratorOwner(cls)) {
            continue;
        }

        const classDecoratorKinds = normalizeDecoratorKinds(cls.getDecorators?.() || []);
        if (classDecoratorKinds.length > 0) {
            candidates.push({
                ownerClass: cls,
                targetKind: "class",
                targetName: cls.getName(),
                decoratorKinds: classDecoratorKinds,
                discoveryLayer: "qualified_decorator_first_layer",
                ownerQualification: "component_owner",
            });
        }

        for (const field of cls.getFields()) {
            if (field.isStatic()) {
                continue;
            }
            pushDecoratedFieldCandidate(candidates, cls, field);
        }

        for (const method of cls.getMethods()) {
            if (method.isStatic() || method.isPrivate()) {
                continue;
            }
            pushDecoratedMethodCandidate(candidates, cls, method);
        }
    }
    return candidates;
}

function isEligibleOverrideMethod(method: ArkMethod): boolean {
    if (method.isStatic() || method.isPrivate()) {
        return false;
    }
    if (method.isGenerated?.() || method.isAnonymousMethod?.()) {
        return false;
    }
    return method.getName() !== CONSTRUCTOR_NAME;
}

function findSdkBaseMethod(superClass: ArkClass, methodName: string): ArkMethod | undefined {
    return getInstanceMethods(superClass)
        .filter(method => method.getName() === methodName)
        .find(method => !method.isStatic() && !method.isPrivate() && method.getName() !== CONSTRUCTOR_NAME);
}

function getInstanceMethods(cls: ArkClass): ArkMethod[] {
    try {
        return (cls.getMethods?.() || []).filter(candidate => !candidate.isStatic());
    } catch {
        return [];
    }
}

function hasSdkImportedSuperclassReference(arkClass: ArkClass | null | undefined): boolean {
    const superClassName = safeGetSuperClassName(arkClass) || "";
    if (!arkClass || !superClassName) {
        return false;
    }
    try {
        const importInfo = arkClass.getDeclaringArkFile?.()?.getImportInfoBy?.(superClassName);
        const importFrom = importInfo?.getFrom?.() || "";
        return isSdkImportFrom(importFrom);
    } catch {
        return false;
    }
}

function isSdkImportFrom(importFrom: string): boolean {
    return /^@(kit|ohos|system)(\.|\/|$)/.test(importFrom || "");
}

function normalizeDecoratorKinds(decorators: any[]): string[] {
    const kinds = new Set<string>();
    for (const decorator of decorators) {
        const raw = decorator?.getKind?.();
        const normalized = String(raw || "").replace(/^@/, "").trim();
        if (normalized) {
            kinds.add(normalized.endsWith("()") ? normalized.slice(0, normalized.length - 2) : normalized);
        }
    }
    return [...kinds.values()].sort((left, right) => left.localeCompare(right));
}

function pushDecoratedFieldCandidate(
    out: ArkMainDecoratorCandidate[],
    ownerClass: ArkClass,
    field: ArkField,
): void {
    const decoratorKinds = normalizeDecoratorKinds(field.getDecorators?.() || []);
    if (decoratorKinds.length === 0) {
        return;
    }
    out.push({
        ownerClass,
        targetKind: "field",
        targetName: field.getName(),
        decoratorKinds,
        discoveryLayer: "qualified_decorator_first_layer",
        ownerQualification: "component_owner",
    });
}

function pushDecoratedMethodCandidate(
    out: ArkMainDecoratorCandidate[],
    ownerClass: ArkClass,
    method: ArkMethod,
): void {
    const decoratorKinds = normalizeDecoratorKinds(method.getDecorators?.() || []);
    if (decoratorKinds.length === 0) {
        return;
    }
    out.push({
        ownerClass,
        targetKind: "method",
        targetName: method.getName(),
        decoratorKinds,
        discoveryLayer: "qualified_decorator_first_layer",
        ownerQualification: "component_owner",
    });
}
