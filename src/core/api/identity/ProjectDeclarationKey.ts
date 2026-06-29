import { normalizeProjectLogicalFilePath, normalizeProjectLogicalTypeText } from "./ProjectLogicalPathNormalization";

export interface ProjectDeclarationKey {
    file: string;
    exportPath: string[];
    ownerPath: string[];
    memberName: string;
    parameterTypes: string[];
    returnType: string;
}

export function projectDeclarationKeyString(key: ProjectDeclarationKey): string {
    return JSON.stringify({
        file: normalizeProjectDeclarationFile(key.file),
        exportPath: normalizeProjectDeclarationExportPath(key.exportPath),
        ownerPath: normalizeProjectDeclarationOwnerPath(key.ownerPath),
        memberName: key.memberName,
        parameterTypes: key.parameterTypes.map(normalizeProjectLogicalTypeText),
        returnType: normalizeProjectLogicalTypeText(key.returnType),
    });
}

function normalizeProjectDeclarationFile(value: string): string {
    return normalizeProjectLogicalFilePath(value);
}

function normalizeProjectDeclarationExportPath(exportPath: readonly string[]): string[] {
    return (exportPath || [])
        .map(segment => {
            const colon = String(segment || "").indexOf(":");
            if (colon <= 0) return segment;
            const kind = segment.slice(0, colon);
            const name = normalizeProjectDefaultOwnerPath(splitOwnerPath(segment.slice(colon + 1))).join(".");
            return `${kind}:${name || "file"}`;
        });
}

function normalizeProjectDeclarationOwnerPath(ownerPath: readonly string[]): string[] {
    return normalizeProjectDefaultOwnerPath(
        (ownerPath || []).flatMap(segment => splitOwnerPath(segment)),
    );
}

function normalizeProjectDefaultOwnerPath(parts: readonly string[]): string[] {
    const normalized = parts.map(part => String(part || "").trim()).filter(Boolean);
    if (normalized.length === 0) return [];
    if (normalized[normalized.length - 1] !== "%dflt") {
        return normalized;
    }
    if (normalized.length === 1) {
        return ["file"];
    }
    return normalized.slice(0, -1);
}

function splitOwnerPath(value: string): string[] {
    return String(value || "")
        .split(".")
        .map(part => part.trim())
        .filter(Boolean);
}
