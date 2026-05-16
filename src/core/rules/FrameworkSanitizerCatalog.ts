import { SanitizerRule, RuleTier } from "./RuleSchema";

interface FrameworkSanitizerSchemaContract {
    id: string;
    tier?: RuleTier;
}

export interface FrameworkSanitizerFamilyContract {
    family: string;
    description: string;
    tags: string[];
    schemas: FrameworkSanitizerSchemaContract[];
}

const SANITIZER_TAGS = ["harmony", "framework_sanitizer"];

export const FRAMEWORK_SANITIZER_FAMILY_CONTRACTS: readonly FrameworkSanitizerFamilyContract[] = [
    {
        family: "sanitizer.harmony.crypto.digest",
        description: "CryptoFramework message-digest APIs return derived digest values rather than the original input bytes.",
        tags: [...SANITIZER_TAGS, "crypto", "digest"],
        schemas: [
            { id: "sanitizer.harmony.crypto.md.digest.result" },
            { id: "sanitizer.harmony.crypto.md.digestSync.result", tier: "A" },
        ],
    },
    {
        family: "sanitizer.harmony.crypto.mac",
        description: "CryptoFramework MAC APIs return keyed authentication codes derived from input bytes.",
        tags: [...SANITIZER_TAGS, "crypto", "mac"],
        schemas: [
            { id: "sanitizer.harmony.crypto.mac.doFinal.result" },
            { id: "sanitizer.harmony.crypto.mac.doFinalSync.result", tier: "A" },
        ],
    },
    {
        family: "sanitizer.harmony.crypto.signature",
        description: "CryptoFramework signing APIs return signature bytes derived from signed input bytes.",
        tags: [...SANITIZER_TAGS, "crypto", "signature"],
        schemas: [
            { id: "sanitizer.harmony.crypto.sign.sign.result" },
            { id: "sanitizer.harmony.crypto.sign.signSync.result", tier: "A" },
        ],
    },
    {
        family: "sanitizer.harmony.file.hash",
        description: "File hash APIs return digest strings for file content or stream content.",
        tags: [...SANITIZER_TAGS, "file", "hash"],
        schemas: [
            { id: "sanitizer.harmony.file.hash.hash.result" },
            { id: "sanitizer.harmony.file.hashstream.digest.result" },
        ],
    },
];

const FRAMEWORK_SANITIZER_SCHEMA_BY_ID = new Map<string, { family: string; tags: string[]; tier: RuleTier }>();
for (const contract of FRAMEWORK_SANITIZER_FAMILY_CONTRACTS) {
    for (const schema of contract.schemas) {
        FRAMEWORK_SANITIZER_SCHEMA_BY_ID.set(schema.id, {
            family: contract.family,
            tags: contract.tags,
            tier: schema.tier || "B",
        });
    }
}

function mergeTags(base: string[] | undefined, extra: string[]): string[] | undefined {
    const merged = [...new Set([...(base || []), ...extra])];
    return merged.length > 0 ? merged : undefined;
}

export function isFrameworkSanitizerCatalogRule(rule: Pick<SanitizerRule, "id">): boolean {
    return FRAMEWORK_SANITIZER_SCHEMA_BY_ID.has(rule.id);
}

export function buildFrameworkSanitizerRules(rawRules: SanitizerRule[]): SanitizerRule[] {
    const byId = new Map<string, SanitizerRule>((rawRules || []).map(rule => [rule.id, rule]));
    const out: SanitizerRule[] = [];
    for (const contract of FRAMEWORK_SANITIZER_FAMILY_CONTRACTS) {
        for (const schema of contract.schemas) {
            const raw = byId.get(schema.id);
            if (!raw) continue;
            out.push({
                ...raw,
                family: contract.family,
                tier: schema.tier || "B",
                tags: mergeTags(raw.tags, contract.tags),
            });
        }
    }
    return out;
}
