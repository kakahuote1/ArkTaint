import type { CellKindId } from "../../cellkind";

export type HandoffEffectKind = "put" | "get" | "kill" | "scoped-link";

export type HandoffHandlePrecision = "exact" | "partial" | "unknown";
export type HandoffCompatibility = "exact" | "may" | "no";
export type HandoffUpdateStrength = "strong" | "weak";
export type HandoffConfidence = "certain" | "likely" | "unknown";
export type HandoffMayCompatibilityPolicy = "conservative" | "block";

export interface HandoffHandle {
    cellKind: CellKindId;
    family: string;
    scope: string;
    key: string;
    precision: HandoffHandlePrecision;
    owner?: string;
    index?: number;
    allocSite?: string;
}

export interface HandoffSourceEndpoint {
    nodeId: number;
    fieldHead?: string;
    fieldPathPrefix?: string[];
}

export interface HandoffCurrentFieldMapping {
    mode: "preserve" | "tail" | "prefix" | "tail-prefix";
    prefix?: string[];
    unwrapPrefixes?: string[];
    stripPrefixes?: string[][];
    requireField?: boolean;
    scalarAlias?: boolean;
}

export interface HandoffTargetEndpoint {
    nodeId: number;
    fieldPath?: string[];
    currentField?: HandoffCurrentFieldMapping;
    allowUnreachableTarget?: boolean;
    preserveSourceField?: boolean;
}

export interface HandoffEffectBase {
    reason: string;
    originModel?: string;
    programPoint?: string;
    flowScope?: string;
    sequence?: number;
    updateStrength?: HandoffUpdateStrength;
    handlePrecision?: HandoffHandlePrecision;
    confidence?: HandoffConfidence;
}

export interface HandoffPutEffect {
    kind: "put";
    handle: HandoffHandle;
    source: HandoffSourceEndpoint;
    reason: string;
    originModel?: string;
    programPoint?: string;
    flowScope?: string;
    sequence?: number;
    updateStrength?: HandoffUpdateStrength;
    handlePrecision?: HandoffHandlePrecision;
    confidence?: HandoffConfidence;
}

export interface HandoffGetEffect {
    kind: "get";
    handle: HandoffHandle;
    target: HandoffTargetEndpoint;
    reason: string;
    originModel?: string;
    programPoint?: string;
    flowScope?: string;
    sequence?: number;
    updateStrength?: HandoffUpdateStrength;
    handlePrecision?: HandoffHandlePrecision;
    confidence?: HandoffConfidence;
}

export interface HandoffKillEffect {
    kind: "kill";
    handle: HandoffHandle;
    reason: string;
    originModel?: string;
    programPoint?: string;
    flowScope?: string;
    sequence?: number;
    updateStrength?: HandoffUpdateStrength;
    handlePrecision?: HandoffHandlePrecision;
    confidence?: HandoffConfidence;
}

export interface HandoffScopedLinkEffect {
    kind: "scoped-link";
    left: HandoffHandle;
    right: HandoffHandle;
    reason: string;
    scopeId?: string;
    originModel?: string;
    programPoint?: string;
    flowScope?: string;
    sequence?: number;
    updateStrength?: HandoffUpdateStrength;
    handlePrecision?: HandoffHandlePrecision;
    confidence?: HandoffConfidence;
}

export type HandoffEffect =
    | HandoffPutEffect
    | HandoffGetEffect
    | HandoffKillEffect
    | HandoffScopedLinkEffect;

export function handoffHandleKey(handle: HandoffHandle): string {
    return [
        handle.cellKind,
        handle.family,
        handle.scope,
        handle.key,
        handle.owner || "",
        handle.index === undefined ? "" : String(handle.index),
        handle.allocSite || "",
        handle.precision,
    ].join("|");
}

export function createExactHandoffHandle(
    cellKind: CellKindId,
    family: string,
    key: string,
    scope = "",
): HandoffHandle {
    return {
        cellKind,
        family,
        scope,
        key,
        precision: "exact",
    };
}

export function createHandoffHandle(
    cellKind: CellKindId,
    family: string,
    key: string,
    options: {
        scope?: string;
        precision?: HandoffHandlePrecision;
        owner?: string;
        index?: number;
        allocSite?: string;
    } = {},
): HandoffHandle {
    return {
        cellKind,
        family,
        scope: options.scope || "",
        key,
        precision: options.precision || "exact",
        owner: options.owner,
        index: options.index,
        allocSite: options.allocSite,
    };
}

export function compatibleHandoffHandles(
    left: HandoffHandle,
    right: HandoffHandle,
): HandoffCompatibility {
    if (handoffHandleKey(left) === handoffHandleKey(right)) {
        return "exact";
    }
    if (left.cellKind !== right.cellKind) return "no";
    if (left.family !== right.family) return "no";
    if (left.scope !== right.scope) return "no";
    if (left.owner !== right.owner) return "no";
    if (left.index !== right.index) return "no";
    if (left.key === right.key) {
        return left.precision === "exact" && right.precision === "exact" ? "exact" : "may";
    }
    if (left.precision === "unknown" || right.precision === "unknown") {
        return "may";
    }
    if (left.precision === "partial" || right.precision === "partial") {
        return "may";
    }
    return "no";
}
