import { Scene } from "../../../../../arkanalyzer/out/src/Scene";
import { ArkClass } from "../../../../../arkanalyzer/out/src/core/model/ArkClass";
import { ArkMethod } from "../../../../../arkanalyzer/out/src/core/model/ArkMethod";
import { normalizeDecoratorKind, resolveAbilityLikeOwnerKind } from "./ArkMainFactResolverUtils";

export type ArkMainManagedOwnerKind =
    | "ability_owner"
    | "stage_owner"
    | "extension_owner"
    | "component_owner";

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
    getEvidences: (cls: ArkClass | null | undefined) => ArkMainManagedOwnerEvidence[];
    getPrimaryRecognitionLayer: (cls: ArkClass | null | undefined) => string | undefined;
}

const OWNER_DECORATORS = new Set(["Entry", "Component", "CustomDialog"]);
const OWNER_DECORATORS_V2 = new Set(["ComponentV2"]);

export function collectFrameworkManagedOwners(
    scene: Scene,
): ArkMainManagedOwnerDiscovery {
    const ownerMap = new Map<string, ArkMainManagedOwnerRecord>();
    const ownerOrder: string[] = [];

    for (const cls of scene.getClasses()) {
        const ownerIdentity = getOwnerIdentity(cls);
        if (!ownerIdentity) continue;

        const record = ensureRecord(ownerMap, ownerOrder, ownerIdentity, cls);
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
    }

    const records = ownerOrder
        .map(ownerIdentity => ownerMap.get(ownerIdentity))
        .filter((record): record is ArkMainManagedOwnerRecord => Boolean(record))
        .filter(record => record.ownerKinds.length > 0);
    const recordByOwnerIdentity = new Map(records.map(record => [getOwnerIdentity(record.ownerClass), record]));

    const hasKind = (cls: ArkClass | null | undefined, kind: ArkMainManagedOwnerKind): boolean => {
        const ownerIdentity = getOwnerIdentity(cls);
        if (!ownerIdentity) return false;
        return recordByOwnerIdentity.get(ownerIdentity)?.ownerKinds.includes(kind) || false;
    };

    return {
        records,
        isFrameworkManagedOwner: (cls: ArkClass | null | undefined): boolean => {
            const ownerIdentity = getOwnerIdentity(cls);
            if (!ownerIdentity) return false;
            return recordByOwnerIdentity.has(ownerIdentity);
        },
        isAbilityOwner: (cls: ArkClass | null | undefined): boolean => hasKind(cls, "ability_owner"),
        isStageOwner: (cls: ArkClass | null | undefined): boolean => hasKind(cls, "stage_owner"),
        isExtensionOwner: (cls: ArkClass | null | undefined): boolean => hasKind(cls, "extension_owner"),
        isComponentOwner: (cls: ArkClass | null | undefined): boolean => hasKind(cls, "component_owner"),
        getEvidences: (cls: ArkClass | null | undefined): ArkMainManagedOwnerEvidence[] => {
            const ownerIdentity = getOwnerIdentity(cls);
            if (!ownerIdentity) return [];
            return [...(recordByOwnerIdentity.get(ownerIdentity)?.evidences || [])];
        },
        getPrimaryRecognitionLayer: (cls: ArkClass | null | undefined): string | undefined => {
            const ownerIdentity = getOwnerIdentity(cls);
            const evidences = ownerIdentity ? (recordByOwnerIdentity.get(ownerIdentity)?.evidences || []) : [];
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
    className: string,
    ownerClass: ArkClass,
): ArkMainManagedOwnerRecord {
    const existing = ownerMap.get(className);
    if (existing) {
        return existing;
    }
    const record: ArkMainManagedOwnerRecord = {
        ownerClass,
        ownerKinds: [],
        evidences: [],
    };
    ownerMap.set(className, record);
    ownerOrder.push(className);
    return record;
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
    if (cls.hasEntryDecorator?.() || cls.hasComponentDecorator?.()) {
        return true;
    }
    const decorators = cls.getDecorators?.() || [];
    return decorators.some(decorator => {
        const kind = normalizeDecoratorKind(decorator?.getKind?.()) || "";
        return OWNER_DECORATORS.has(kind) || OWNER_DECORATORS_V2.has(kind);
    });
}

function getOwnerIdentity(cls: ArkClass | null | undefined): string {
    if (!cls) return "";
    const classSig = cls.getSignature?.();
    if (classSig?.toString?.()) {
        return classSig.toString();
    }
    const className = cls.getName?.() || "";
    if (!className) return "";
    const fileSig = classSig?.getDeclaringFileSignature?.()?.toString?.() || "";
    return fileSig ? `${fileSig}::${className}` : className;
}
