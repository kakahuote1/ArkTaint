import { BaseRule } from "./RuleSchema";

type GovernedRule = Pick<BaseRule, "id" | "family" | "tier">;

export function resolveRuleFamily(rule: GovernedRule): string | undefined {
    const family = typeof rule.family === "string" ? rule.family.trim() : "";
    return family.length > 0 ? family : undefined;
}

export function resolveRuleFamilyKey(rule: GovernedRule): string {
    return resolveRuleFamily(rule) || rule.id;
}

export function resolveRuleTierWeight(rule: Pick<BaseRule, "tier">): number {
    if (rule.tier === "A") return 3;
    if (rule.tier === "B") return 2;
    if (rule.tier === "C") return 1;
    return 0;
}

export function compareRulesByFamilyTierAndId<T extends GovernedRule>(a: T, b: T): number {
    const familyA = resolveRuleFamilyKey(a);
    const familyB = resolveRuleFamilyKey(b);
    if (familyA !== familyB) return familyA.localeCompare(familyB);

    const tierA = resolveRuleTierWeight(a);
    const tierB = resolveRuleTierWeight(b);
    if (tierA !== tierB) return tierB - tierA;

    return a.id.localeCompare(b.id);
}

export function orderRulesByFamilyTier<T extends GovernedRule>(rules: T[]): T[] {
    return [...rules].sort(compareRulesByFamilyTierAndId);
}

export function filterBestTierRulesByFamily<T extends GovernedRule>(rules: T[]): T[] {
    const ordered = orderRulesByFamilyTier(rules);
    const bestTierByFamily = new Map<string, number>();
    for (const rule of ordered) {
        const familyKey = resolveRuleFamilyKey(rule);
        const tier = resolveRuleTierWeight(rule);
        const best = bestTierByFamily.get(familyKey) || 0;
        if (tier > best) {
            bestTierByFamily.set(familyKey, tier);
        }
    }

    return ordered.filter(rule => {
        const familyKey = resolveRuleFamilyKey(rule);
        const tier = resolveRuleTierWeight(rule);
        return tier >= (bestTierByFamily.get(familyKey) || 0);
    });
}
