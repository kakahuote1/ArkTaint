const PROJECT_LOGICAL_SOURCE_ROOTS = [
    { root: "src/main/ets/", normalizedRoot: "ets/" },
    { root: "ets/", normalizedRoot: "ets/" },
    { root: "src/ohostest/ets/", normalizedRoot: "ohostest/ets/" },
    { root: "ohostest/ets/", normalizedRoot: "ohostest/ets/" },
    { root: "src/test/ets/", normalizedRoot: "test/ets/" },
    { root: "test/ets/", normalizedRoot: "test/ets/" },
    { root: "inputs/", normalizedRoot: "inputs/" },
] as const;

export function normalizeProjectLogicalFilePath(value: string): string {
    const normalized = String(value || "")
        .replace(/\\/g, "/")
        .replace(/^@/, "")
        .replace(/:\s*$/, "")
        .replace(/^\/+|\/+$/g, "")
        .trim();
    for (const { root, normalizedRoot } of PROJECT_LOGICAL_SOURCE_ROOTS) {
        const index = normalized.lastIndexOf(root);
        if (index >= 0) {
            return `${normalizedRoot}${normalized.slice(index + root.length)}`;
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
