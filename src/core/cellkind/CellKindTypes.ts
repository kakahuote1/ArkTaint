export const BUILTIN_CELL_KIND_IDS = [
    "value-version",
    "local-slot",
    "parameter-slot",
    "return-slot",
    "object-field",
    "static-field",
    "array-element",
    "indexed-element",
    "map-entry",
    "object-entry",
    "collection-element",
    "keyed-semantic-slot",
    "message-channel-slot",
    "navigation-param-slot",
    "async-result-slot",
    "reactive-state-slot",
    "resource-handle-slot",
    "callback-context-slot",
    "global-context-slot",
    "persistent-storage-slot",
] as const;

export type CellKindId = typeof BUILTIN_CELL_KIND_IDS[number];

export type CellKindDimension =
    | "scope"
    | "owner"
    | "key"
    | "fieldPath"
    | "index"
    | "allocSite"
    | "valueVersion";

export type CellKindCategory =
    | "value"
    | "language-location"
    | "semantic-location";

export type CellKindUpdatePolicy =
    | "none"
    | "strong-when-exact"
    | "weak-only";

export type CellKindCompatibilityPolicy =
    | "canonical-dimensions";

export type CellKindLinkPolicy =
    | "none"
    | "explicit-link";

export interface CellKindSpec {
    id: CellKindId;
    category: CellKindCategory;
    description: string;
    requiredDimensions: CellKindDimension[];
    optionalDimensions?: CellKindDimension[];
    allowedEffects: string[];
    compatibilityPolicy: CellKindCompatibilityPolicy;
    updatePolicy: CellKindUpdatePolicy;
    linkPolicy: CellKindLinkPolicy;
}
