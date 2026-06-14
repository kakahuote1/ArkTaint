import {
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

    semanticLocation("account-credential-slot", "Official account, auth, user identity, or credential state slot.", ["owner", "key"]),
    semanticLocation("datashare-slot", "Official DataShare data, predicate, or row-set handoff slot.", ["owner", "key"]),
    semanticLocation("event-payload-slot", "Official event, IPC, notification, or message payload slot.", ["owner", "key"]),
    semanticLocation("file-content-slot", "Official file, URI, picker, document, or stream content slot.", ["owner", "key"]),
    semanticLocation("keyed-preferences-slot", "Official Preferences or key-value storage slot.", ["owner", "key"]),
    semanticLocation("media-source-slot", "Official media, image, camera, AV, or pixel-map content slot.", ["owner", "key"]),
    semanticLocation("network-request-slot", "Official network request, response, header, or socket payload slot.", ["owner", "key"]),
    semanticLocation("rdb-distributed-handoff-cell", "Official distributed relational database handoff slot.", ["owner", "key"]),
    semanticLocation("rdb-file-handoff-cell", "Official relational database import, export, backup, or attachment file slot.", ["owner", "key"]),
    semanticLocation("rdb-handle-cell", "Official relational database handle, transaction, or connection slot.", ["owner", "key"]),
    semanticLocation("rdb-predicate-cell", "Official relational database predicate, query condition, or selection slot.", ["owner", "key"]),
    semanticLocation("rdb-remote-query-cell", "Official relational database remote query or device query slot.", ["owner", "key"]),
    semanticLocation("rdb-resultset-cell", "Official relational database result-set or row cursor slot.", ["owner", "key"]),
    semanticLocation("rdb-security-config-cell", "Official relational database security, encryption, or access-control config slot.", ["owner", "key"]),
    semanticLocation("rdb-sql-cell", "Official relational database SQL statement, bind-argument, or execution slot.", ["owner", "key"]),
    semanticLocation("rdb-store-cell", "Official relational database store, table, row, or value slot.", ["owner", "key"]),
    semanticLocation("security-asset-slot", "Official security asset, keychain, credential manager, or protected asset slot.", ["owner", "key"]),
    semanticLocation("security-credential-slot", "Official credential, token, key, crypto material, or auth secret slot.", ["owner", "key"]),
    semanticLocation("system-pasteboard-slot", "Official pasteboard, clipboard, or unified-data slot.", ["owner", "key"]),
    semanticLocation("ui-display-slot", "Official UI display, form, notification, dialog, canvas, or visible content slot.", ["owner", "key"]),
    semanticLocation("webview-resource-slot", "Official WebView URL, request, resource, JavaScript bridge, or web payload slot.", ["owner", "key"]),
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
