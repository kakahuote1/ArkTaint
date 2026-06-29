const PROJECT_LOGICAL_SOURCE_ROOTS = [
    "src/main/ets/",
    "src/ohostest/ets/",
    "src/test/ets/",
    "ets/",
    "inputs/",
];

export function normalizeProjectLogicalFilePath(value: string): string {
    const normalized = String(value || "")
        .replace(/\\/g, "/")
        .replace(/^@/, "")
        .replace(/:\s*$/, "")
        .replace(/^\/+|\/+$/g, "")
        .trim();
    for (const root of PROJECT_LOGICAL_SOURCE_ROOTS) {
        const index = normalized.lastIndexOf(root);
        if (index >= 0) {
            return normalized.slice(index);
        }
    }
    return normalized;
}

export function normalizeProjectLogicalTypeText(value: string): string {
    return String(value || "")
        .replace(/\\/g, "/")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/@([^,:()<>\s]+):/g, (_match, rawFile: string) => {
            const normalizedFile = normalizeProjectLogicalFilePath(rawFile);
            return `@${normalizedFile}:`;
        });
}
