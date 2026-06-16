import { RuleEndpoint } from "../../rules/RuleSchema";
import { FieldLocation, FieldLocationKind, makeFieldLocation } from "./FieldLocation";
import { FieldPrecision, normalizeFieldPath } from "./FieldPath";
import { decideFieldPrecision } from "./FieldPrecisionPolicy";

export interface FieldEndpointProjectionInput {
    endpoint: RuleEndpoint | string;
    ownerNodeId: number;
    contextId: number;
    accessPath?: readonly unknown[];
    cellKind?: FieldLocationKind;
    precision?: FieldPrecision;
    owner?: string;
    method?: string;
}

export interface FieldEndpointProjection {
    location?: FieldLocation;
    status: "projected" | "not-field" | "invalid-field";
    reason: string;
}

export function projectFieldEndpoint(input: FieldEndpointProjectionInput): FieldEndpointProjection {
    if (!input.accessPath || input.accessPath.length === 0) {
        return {
            status: "not-field",
            reason: "empty-access-path",
        };
    }
    const precisionDecision = decideFieldPrecision(input.accessPath, input.precision || "exact");
    const normalized = normalizeFieldPath(input.accessPath, precisionDecision.precision);
    if (!normalized || normalized.segments.length === 0) {
        return {
            status: "invalid-field",
            reason: "field-path-normalization-empty",
        };
    }
    const location = makeFieldLocation(
        input.cellKind || "object-field",
        input.ownerNodeId,
        input.contextId,
        normalized.segments,
        precisionDecision.precision,
    );
    location.owner = input.owner;
    location.method = input.method;
    return {
        location,
        status: "projected",
        reason: precisionDecision.reason,
    };
}
