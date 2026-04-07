import { ArkClass } from "../../../../../arkanalyzer/out/src/core/model/ArkClass";
import { ArkMethod } from "../../../../../arkanalyzer/out/src/core/model/ArkMethod";
import { ARK_MAIN_ABILITY_BASE_CLASS_NAMES } from "../catalog/ArkMainFrameworkCatalog";

export function classInheritsAbility(arkClass: ArkClass): boolean {
    return !!resolveAbilityLikeOwnerKind(arkClass);
}

export function resolveAbilityLikeOwnerKind(
    arkClass: ArkClass,
): "ability_owner" | "stage_owner" | "extension_owner" | undefined {
    const directKind = classifyAbilityOwnerBaseName(arkClass.getSuperClassName());
    if (directKind) {
        return directKind;
    }
    let superClass = arkClass.getSuperClass();
    while (superClass) {
        const namedKind = classifyAbilityOwnerBaseName(superClass.getName?.());
        if (namedKind) {
            return namedKind;
        }
        const inheritedKind = classifyAbilityOwnerBaseName(superClass.getSuperClassName());
        if (inheritedKind) {
            return inheritedKind;
        }
        superClass = superClass.getSuperClass();
    }
    return undefined;
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

function classifyAbilityOwnerBaseName(
    raw: string | undefined,
): "ability_owner" | "stage_owner" | "extension_owner" | undefined {
    const normalized = normalizeClassName(raw);
    if (!normalized) return undefined;
    if (normalized === "AbilityStage") {
        return "stage_owner";
    }
    if (normalized.endsWith("ExtensionAbility")) {
        return "extension_owner";
    }
    return ARK_MAIN_ABILITY_BASE_CLASS_NAMES.has(normalized)
        ? "ability_owner"
        : undefined;
}

function normalizeClassName(raw: string | undefined): string {
    return (raw || "").replace(/^@/, "").trim();
}


