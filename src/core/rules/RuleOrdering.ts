import { BaseRule } from "./RuleSchema";

type GovernedRule = Pick<BaseRule, "id" | "family">;

export function resolveRuleFamily(rule: GovernedRule): string | undefined {
    const family = typeof rule.family === "string" ? rule.family.trim() : "";
    return family.length > 0 ? family : undefined;
}

export function resolveRuleFamilyKey(rule: GovernedRule): string {
    return resolveRuleFamily(rule) || rule.id;
}

export function compareRulesByFamilyAndId<T extends GovernedRule>(a: T, b: T): number {
    const familyA = resolveRuleFamilyKey(a);
    const familyB = resolveRuleFamilyKey(b);
    if (familyA !== familyB) return familyA.localeCompare(familyB);
    return a.id.localeCompare(b.id);
}

export function orderRulesByFamilyAndId<T extends GovernedRule>(rules: T[]): T[] {
    return [...rules].sort(compareRulesByFamilyAndId);
}

export function orderRulesForSameFamilySelection<T extends GovernedRule>(rules: T[]): T[] {
    return orderRulesByFamilyAndId(rules);
}
