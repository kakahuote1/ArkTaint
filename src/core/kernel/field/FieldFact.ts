import { FieldLocation, fieldLocationKey } from "./FieldLocation";

export interface FieldFact {
    location: FieldLocation;
    source: string;
    factId?: string;
    valueKind?: "value" | "field" | "container" | "unknown";
    confidence?: "certain" | "likely" | "unknown";
    predecessor?: string;
}

export function fieldFactKey(fact: FieldFact): string {
    return `${fieldLocationKey(fact.location)}|${fact.source}|${fact.factId || ""}`;
}
