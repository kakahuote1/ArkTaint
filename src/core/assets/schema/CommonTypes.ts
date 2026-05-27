export type AssetPlane = "rule" | "module" | "arkmain";

export type AssetStatus =
    | "candidate"
    | "llm-generated"
    | "schema-valid"
    | "reviewed"
    | "replayed"
    | "official"
    | "deprecated"
    | "rejected";

export type Confidence = "certain" | "likely" | "unknown";

export interface SourceLocation {
    file: string;
    line?: number;
    column?: number;
}

export interface ProgramPoint {
    methodSignature: string;
    stmtId: string;
    blockId?: string;
}

export interface ValidationResult {
    valid: boolean;
    errors: string[];
    warnings: string[];
}

export function ok(): ValidationResult {
    return { valid: true, errors: [], warnings: [] };
}

export function result(errors: string[], warnings: string[] = []): ValidationResult {
    return { valid: errors.length === 0, errors, warnings };
}
