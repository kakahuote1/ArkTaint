import { Scene } from "../../../../../arkanalyzer/out/src/Scene";
import { ArkClass } from "../../../../../arkanalyzer/out/src/core/model/ArkClass";
import { ArkMethod } from "../../../../../arkanalyzer/out/src/core/model/ArkMethod";
import {
    ARK_MAIN_BUILDER_DECORATOR,
    ARK_MAIN_OWNER_DECORATORS,
} from "../catalog/ArkMainFrameworkCatalog";
import { normalizeDecoratorKind, resolveAbilityLikeOwnerKind } from "./ArkMainFactResolverUtils";

export type ArkMainManagedOwnerKind =
    | "ability_owner"
    | "stage_owner"
    | "extension_owner"
    | "component_owner"
    | "builder_owner";

export interface ArkMainManagedOwnerEvidence {
    ownerKind: ArkMainManagedOwnerKind;
    recognitionLayer:
        | "owner_qualified_inheritance"
        | "qualified_decorator_first_layer";
    reason: string;
}

export interface ArkMainManagedOwnerRecord {
    ownerClass: ArkClass;
    ownerKinds: ArkMainManagedOwnerKind[];
    evidences: ArkMainManagedOwnerEvidence[];
}

export interface ArkMainManagedOwnerDiscovery {
    records: ArkMainManagedOwnerRecord[];
    isFrameworkManagedOwner: (cls: ArkClass | null | undefined) => boolean;
    isAbilityOwner: (cls: ArkClass | null | undefined) => boolean;
    isStageOwner: (cls: ArkClass | null | undefined) => boolean;
    isExtensionOwner: (cls: ArkClass | null | undefined) => boolean;
    isComponentOwner: (cls: ArkClass | null | undefined) => boolean;
    isBuilderOwner: (cls: ArkClass | null | undefined) => boolean;
    getEvidences: (cls: ArkClass | null | undefined) => ArkMainManagedOwnerEvidence[];
    getPrimaryRecognitionLayer: (cls: ArkClass | null | undefined) => string | undefined;
}

export function collectFrameworkManagedOwners(
    scene: Scene,
): ArkMainManagedOwnerDiscovery {
    const ownerMap = new Map<string, ArkMainManagedOwnerRecord>();
    const ownerOrder: string[] = [];

    for (const cls of scene.getClasses()) {
        const classIdentity = getClassIdentity(cls);
        if (!classIdentity) continue;

        const record = ensureRecord(ownerMap, ownerOrder, classIdentity, cls);
        const inheritedOwnerKind = resolveAbilityLikeOwnerKind(cls);
        if (inheritedOwnerKind) {
            pushEvidence(record, {
                ownerKind: inheritedOwnerKind,
                recognitionLayer: "owner_qualified_inheritance",
                reason: "inherits sdk managed owner base class",
            });
        }

        if (hasOwnerDecorator(cls)) {
            pushEvidence(record, {
                ownerKind: "component_owner",
                recognitionLayer: "qualified_decorator_first_layer",
                reason: "class has framework owner decorator",
            });
        }

        if (hasBuilderDecorator(cls)) {
            pushEvidence(record, {
                ownerKind: "builder_owner",
                recognitionLayer: "qualified_decorator_first_layer",
                reason: "class/method carries @Builder decorator",
            });
        }
    }

    const records = ownerOrder
        .map(classIdentity => ownerMap.get(classIdentity))
        .filter((record): record is ArkMainManagedOwnerRecord => Boolean(record))
        .filter(record => record.ownerKinds.length > 0);
    const recordByClassIdentity = new Map(
        records
            .map(record => {
                const classIdentity = getClassIdentity(record.ownerClass);
                return classIdentity ? [classIdentity, record] as const : undefined;
            })
            .filter((item): item is readonly [string, ArkMainManagedOwnerRecord] => Boolean(item)),
    );

    const hasKind = (cls: ArkClass | null | undefined, kind: ArkMainManagedOwnerKind): boolean => {
        const classIdentity = getClassIdentity(cls);
        if (!classIdentity) return false;
        return recordByClassIdentity.get(classIdentity)?.ownerKinds.includes(kind) || false;
    };

    return {
        records,
        isFrameworkManagedOwner: (cls: ArkClass | null | undefined): boolean => {
            const classIdentity = getClassIdentity(cls);
            if (!classIdentity) return false;
            return recordByClassIdentity.has(classIdentity);
        },
        isAbilityOwner: (cls: ArkClass | null | undefined): boolean => hasKind(cls, "ability_owner"),
        isStageOwner: (cls: ArkClass | null | undefined): boolean => hasKind(cls, "stage_owner"),
        isExtensionOwner: (cls: ArkClass | null | undefined): boolean => hasKind(cls, "extension_owner"),
        isComponentOwner: (cls: ArkClass | null | undefined): boolean => hasKind(cls, "component_owner"),
        isBuilderOwner: (cls: ArkClass | null | undefined): boolean => hasKind(cls, "builder_owner"),
        getEvidences: (cls: ArkClass | null | undefined): ArkMainManagedOwnerEvidence[] => {
            const classIdentity = getClassIdentity(cls);
            if (!classIdentity) return [];
            return [...(recordByClassIdentity.get(classIdentity)?.evidences || [])];
        },
        getPrimaryRecognitionLayer: (cls: ArkClass | null | undefined): string | undefined => {
            const evidences = cls
                ? (recordByClassIdentity.get(getClassIdentity(cls) || "")?.evidences || [])
                : [];
            if (evidences.some(evidence => evidence.recognitionLayer === "qualified_decorator_first_layer")) {
                return "qualified_decorator_first_layer";
            }
            return evidences[0]?.recognitionLayer;
        },
    };
}

function ensureRecord(
    ownerMap: Map<string, ArkMainManagedOwnerRecord>,
    ownerOrder: string[],
    classIdentity: string,
    ownerClass: ArkClass,
): ArkMainManagedOwnerRecord {
    const existing = ownerMap.get(classIdentity);
    if (existing) {
        return existing;
    }
    const record: ArkMainManagedOwnerRecord = {
        ownerClass,
        ownerKinds: [],
        evidences: [],
    };
    ownerMap.set(classIdentity, record);
    ownerOrder.push(classIdentity);
    return record;
}

function getClassIdentity(cls: ArkClass | null | undefined): string | undefined {
    if (!cls) return undefined;
    const signatureText = cls.getSignature?.()?.toString?.();
    if (signatureText) return signatureText;
    const fileSignatureText = cls.getDeclaringArkFile?.()?.getFileSignature?.()?.toString?.()
        || cls.getSignature?.()?.getDeclaringFileSignature?.()?.toString?.()
        || "";
    const className = cls.getName?.() || "";
    if (!className) return undefined;
    return `${fileSignatureText}::${className}`;
}

function pushEvidence(record: ArkMainManagedOwnerRecord, evidence: ArkMainManagedOwnerEvidence): void {
    if (!record.ownerKinds.includes(evidence.ownerKind)) {
        record.ownerKinds.push(evidence.ownerKind);
    }
    const key = `${evidence.ownerKind}|${evidence.recognitionLayer}|${evidence.reason}`;
    const hasSameEvidence = record.evidences.some(item =>
        `${item.ownerKind}|${item.recognitionLayer}|${item.reason}` === key,
    );
    if (!hasSameEvidence) {
        record.evidences.push(evidence);
    }
}

function hasOwnerDecorator(cls: ArkClass): boolean {
    const decorators = cls.getDecorators?.() || [];
    return decorators.some(decorator =>
        ARK_MAIN_OWNER_DECORATORS.has(normalizeDecoratorKind(decorator?.getKind?.()) || ""),
    );
}

function hasBuilderDecorator(cls: ArkClass): boolean {
    const classHasBuilder = (cls.getDecorators?.() || [])
        .some(decorator => normalizeDecoratorKind(decorator?.getKind?.()) === ARK_MAIN_BUILDER_DECORATOR);
    if (classHasBuilder) {
        return true;
    }
    return cls.getMethods().some((method: ArkMethod) =>
        !method.isStatic()
        && (method.getDecorators?.() || []).some(decorator =>
            normalizeDecoratorKind(decorator?.getKind?.()) === ARK_MAIN_BUILDER_DECORATOR,
        ),
    );
}
