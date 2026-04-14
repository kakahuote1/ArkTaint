import { ArkAssignStmt } from "../../../../../arkanalyzer/out/src/core/base/Stmt";
import { ArkInstanceFieldRef } from "../../../../../arkanalyzer/out/src/core/base/Ref";
import { ArkClass } from "../../../../../arkanalyzer/out/src/core/model/ArkClass";
import { ArkMethod } from "../../../../../arkanalyzer/out/src/core/model/ArkMethod";
import { ArkMainEntryFact } from "../ArkMainTypes";
import {
    ARK_MAIN_ABILITY_BASE_CLASS_NAMES,
    ARK_MAIN_REACTIVE_ANCHOR_METHOD_NAMES,
    ARK_MAIN_WATCH_LIKE_DECORATORS,
} from "../catalog/ArkMainFrameworkCatalog";

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

export function findReactiveAnchorMethod(cls: ArkClass): ArkMethod | undefined {
    return findReactiveAnchorMethods(cls)[0];
}

export function findReactiveAnchorMethods(cls: ArkClass): ArkMethod[] {
    const methods = cls.getMethods().filter(method => !method.isStatic());
    const anchors: ArkMethod[] = [];
    for (const methodName of ARK_MAIN_REACTIVE_ANCHOR_METHOD_NAMES) {
        const matched = methods.filter(method => method.getName() === methodName);
        anchors.push(...matched);
    }
    if (anchors.length > 0) {
        return dedupeMethods(anchors);
    }

    const watchMethods = methods.filter(method =>
        (method.getDecorators?.() || []).some(decorator => {
            const kind = normalizeDecoratorKind(decorator?.getKind?.());
            return !!kind && ARK_MAIN_WATCH_LIKE_DECORATORS.has(kind);
        }),
    );
    if (watchMethods.length > 0) {
        return dedupeMethods(watchMethods);
    }
    return [];
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

export function extractWatchTargets(decorators: any[]): string[] {
    const out = new Set<string>();
    for (const decorator of decorators) {
        const kind = normalizeDecoratorKind(decorator?.getKind?.());
        if (!kind || !ARK_MAIN_WATCH_LIKE_DECORATORS.has(kind)) continue;
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

function normalizeDecoratorParam(raw: string): string | undefined {
    const text = String(raw || "").trim();
    if (!text) return undefined;
    const quoted = text.match(/^["'`](.+)["'`]$/);
    if (quoted) return quoted[1];
    const contentMatch = text.match(/\(\s*['"`]([^'"`]+)['"`]\s*\)/);
    if (contentMatch) return contentMatch[1];
    return text;
}

function normalizeClassName(raw: string | undefined): string {
    return (raw || "").replace(/^@/, "").trim();
}


