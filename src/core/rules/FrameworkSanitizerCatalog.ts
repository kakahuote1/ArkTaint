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

export const FRAMEWORK_SANITIZER_FAMILY_CONTRACTS: readonly FrameworkSanitizerFamilyContract[] = [];

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
