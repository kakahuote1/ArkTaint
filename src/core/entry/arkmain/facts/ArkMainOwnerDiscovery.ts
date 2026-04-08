import { Scene } from "../../../../../arkanalyzer/lib/Scene";
import { ArkClass } from "../../../../../arkanalyzer/lib/core/model/ArkClass";
import { ArkMethod } from "../../../../../arkanalyzer/lib/core/model/ArkMethod";
import { normalizeDecoratorKind, resolveAbilityLikeOwnerKind } from "./ArkMainFactResolverUtils";
import { resolveComponentLifecycleContract } from "./ArkMainLifecycleContracts";

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
        | "qualified_decorator_first_layer"
        | "component_contract_shape";
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

export interface ArkMainManagedOwnerDiscoveryOptions {
    includeComponentContractShape?: boolean;
}

const OWNER_DECORATORS = new Set(["Entry", "Component", "CustomDialog"]);
const BUILDER_DECORATOR = "Builder";

export function collectFrameworkManagedOwners(
    scene: Scene,
    options: ArkMainManagedOwnerDiscoveryOptions = {},
): ArkMainManagedOwnerDiscovery {
    const ownerMap = new Map<string, ArkMainManagedOwnerRecord>();
    const ownerOrder: string[] = [];
    const includeComponentContractShape = options.includeComponentContractShape ?? true;

    for (const cls of scene.getClasses()) {
        const className = cls.getName?.() || "";
        if (!className) continue;

        const record = ensureRecord(ownerMap, ownerOrder, className, cls);
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

        if (includeComponentContractShape && hasComponentLifecycleContractShape(cls)) {
            pushEvidence(record, {
                ownerKind: "component_owner",
                recognitionLayer: "component_contract_shape",
                reason: "class declares component lifecycle contract method",
            });
        }
    }

    const records = ownerOrder
        .map(className => ownerMap.get(className))
        .filter((record): record is ArkMainManagedOwnerRecord => Boolean(record))
        .filter(record => record.ownerKinds.length > 0);
    const recordByClassName = new Map(records.map(record => [record.ownerClass.getName?.() || "", record]));

    const hasKind = (cls: ArkClass | null | undefined, kind: ArkMainManagedOwnerKind): boolean => {
        const className = cls?.getName?.() || "";
        if (!className) return false;
        return recordByClassName.get(className)?.ownerKinds.includes(kind) || false;
    };

    return {
        records,
        isFrameworkManagedOwner: (cls: ArkClass | null | undefined): boolean => {
            const className = cls?.getName?.() || "";
            if (!className) return false;
            return recordByClassName.has(className);
        },
        isAbilityOwner: (cls: ArkClass | null | undefined): boolean => hasKind(cls, "ability_owner"),
        isStageOwner: (cls: ArkClass | null | undefined): boolean => hasKind(cls, "stage_owner"),
        isExtensionOwner: (cls: ArkClass | null | undefined): boolean => hasKind(cls, "extension_owner"),
        isComponentOwner: (cls: ArkClass | null | undefined): boolean => hasKind(cls, "component_owner"),
        isBuilderOwner: (cls: ArkClass | null | undefined): boolean => hasKind(cls, "builder_owner"),
        getEvidences: (cls: ArkClass | null | undefined): ArkMainManagedOwnerEvidence[] => {
            const className = cls?.getName?.() || "";
            if (!className) return [];
            return [...(recordByClassName.get(className)?.evidences || [])];
        },
        getPrimaryRecognitionLayer: (cls: ArkClass | null | undefined): string | undefined => {
            const evidences = cls ? (recordByClassName.get(cls.getName?.() || "")?.evidences || []) : [];
            if (evidences.some(evidence => evidence.recognitionLayer === "qualified_decorator_first_layer")) {
                return "qualified_decorator_first_layer";
            }
            if (evidences.some(evidence => evidence.recognitionLayer === "component_contract_shape")) {
                return "component_contract_shape";
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
    return decorators.some(decorator => OWNER_DECORATORS.has(normalizeDecoratorKind(decorator?.getKind?.()) || ""));
}

function hasBuilderDecorator(cls: ArkClass): boolean {
    const classHasBuilder = (cls.getDecorators?.() || [])
        .some(decorator => normalizeDecoratorKind(decorator?.getKind?.()) === BUILDER_DECORATOR);
    if (classHasBuilder) {
        return true;
    }
    return cls.getMethods().some((method: ArkMethod) =>
        !method.isStatic()
        && (method.getDecorators?.() || []).some(decorator => normalizeDecoratorKind(decorator?.getKind?.()) === BUILDER_DECORATOR),
    );
}

function hasComponentLifecycleContractShape(cls: ArkClass): boolean {
    return cls.getMethods().some((method: ArkMethod) =>
        !method.isStatic() && !!resolveComponentLifecycleContract(method.getName()),
    );
}
