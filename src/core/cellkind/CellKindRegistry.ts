import {
    BUILTIN_CELL_KIND_IDS,
    CellKindId,
    CellKindSpec,
} from "./CellKindTypes";

export class CellKindRegistry {
    private readonly specs = new Map<string, CellKindSpec>();

    constructor(specs: readonly CellKindSpec[]) {
        for (const spec of specs) {
            this.register(spec);
        }
    }

    register(spec: CellKindSpec): void {
        if (!BUILTIN_CELL_KIND_IDS.includes(spec.id)) {
            throw new Error(`unregistered built-in CellKindId ${spec.id}`);
        }
        if (this.specs.has(spec.id)) {
            throw new Error(`duplicate CellKindId ${spec.id}`);
        }
        this.specs.set(spec.id, spec);
    }

    has(id: string): id is CellKindId {
        return this.specs.has(id);
    }

    get(id: string): CellKindSpec | undefined {
        return this.specs.get(id);
    }

    require(id: string): CellKindSpec {
        const spec = this.get(id);
        if (!spec) {
            throw new Error(`CellKindId is not registered: ${id}`);
        }
        return spec;
    }

    all(): CellKindSpec[] {
        return [...this.specs.values()];
    }
}

export const DEFAULT_CELL_KIND_REGISTRY = new CellKindRegistry([
    value("value-version", "Immutable value version such as x#1 or return#2.", ["valueVersion"]),

    languageLocation("local-slot", "Mutable local variable slot.", ["owner"]),
    languageLocation("parameter-slot", "Mutable parameter slot.", ["owner"]),
    languageLocation("return-slot", "Return-value slot.", ["owner"]),
    languageLocation("object-field", "Object field path such as obj.f or obj.deep.f.", ["owner", "fieldPath"]),
    languageLocation("static-field", "Class or module static field.", ["owner", "fieldPath"]),
    languageLocation("array-element", "Array element with a known index.", ["owner", "index"]),
    languageLocation("indexed-element", "Indexed container element with a key-like index.", ["owner", "key"]),
    languageLocation("map-entry", "Map, HashMap, Dictionary, or key-value entry.", ["owner", "key"]),
    languageLocation("object-entry", "Plain object or JSON object property.", ["owner", "key"]),
    languageLocation("collection-element", "Set, List, Queue, Vector, or broad collection element.", ["owner"], "weak-only"),

    semanticLocation("keyed-semantic-slot", "Keyed semantic handoff slot such as cache, storage, session, or token store.", ["owner", "key"]),
    semanticLocation("message-channel-slot", "Publish/subscribe or message-channel payload slot.", ["owner", "key"]),
    semanticLocation("navigation-param-slot", "Navigation or page parameter slot.", ["owner", "key"]),
    semanticLocation("async-result-slot", "Promise, async/await, then, or callback-result slot.", ["owner", "key"]),
    semanticLocation("reactive-state-slot", "Reactive UI or state-management slot.", ["owner", "key"]),
    semanticLocation("resource-handle-slot", "Resource handle state such as file, DB, request, or stream handle.", ["owner", "key"]),
    semanticLocation("callback-context-slot", "Context bound at callback registration or framework invocation.", ["owner", "key"]),
    semanticLocation("global-context-slot", "Global or application context store.", ["owner", "key"]),
    semanticLocation("persistent-storage-slot", "File, database, KV, DataShare, or other persistent storage slot.", ["owner", "key"]),
]);

export function isRegisteredCellKindId(id: unknown): id is CellKindId {
    return typeof id === "string" && DEFAULT_CELL_KIND_REGISTRY.has(id);
}

export function isValueCellKind(id: string): boolean {
    return DEFAULT_CELL_KIND_REGISTRY.get(id)?.category === "value";
}

export function isMutableCellKind(id: string): boolean {
    const category = DEFAULT_CELL_KIND_REGISTRY.get(id)?.category;
    return category === "language-location" || category === "semantic-location";
}

export function canCellKindStronglyUpdate(id: string): boolean {
    return DEFAULT_CELL_KIND_REGISTRY.get(id)?.updatePolicy === "strong-when-exact";
}

function value(id: CellKindId, description: string, requiredDimensions: CellKindSpec["requiredDimensions"]): CellKindSpec {
    return {
        id,
        category: "value",
        description,
        requiredDimensions,
        optionalDimensions: ["scope", "owner"],
        allowedEffects: ["source", "copy", "sink", "sanitize"],
        compatibilityPolicy: "canonical-dimensions",
        updatePolicy: "none",
        linkPolicy: "none",
    };
}

function languageLocation(
    id: CellKindId,
    description: string,
    requiredDimensions: CellKindSpec["requiredDimensions"],
    updatePolicy: CellKindSpec["updatePolicy"] = "strong-when-exact",
): CellKindSpec {
    return {
        id,
        category: "language-location",
        description,
        requiredDimensions,
        optionalDimensions: ["scope", "key", "index", "allocSite", "fieldPath"],
        allowedEffects: ["store", "load", "store-clean", "kill", "link", "unlink"],
        compatibilityPolicy: "canonical-dimensions",
        updatePolicy,
        linkPolicy: "explicit-link",
    };
}

function semanticLocation(
    id: CellKindId,
    description: string,
    requiredDimensions: CellKindSpec["requiredDimensions"],
    updatePolicy: CellKindSpec["updatePolicy"] = "strong-when-exact",
): CellKindSpec {
    return {
        id,
        category: "semantic-location",
        description,
        requiredDimensions,
        optionalDimensions: ["scope", "owner", "index", "allocSite", "fieldPath"],
        allowedEffects: ["store", "load", "store-clean", "kill", "link", "unlink"],
        compatibilityPolicy: "canonical-dimensions",
        updatePolicy,
        linkPolicy: "explicit-link",
    };
}
