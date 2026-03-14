import { TaintFact } from "../TaintFact";

export interface HarmonySeedCollectionArgs {
    emptyContextId: number;
    allowedMethodSignatures?: Set<string>;
}

export interface HarmonySeedCollectionResult {
    facts: TaintFact[];
    seededLocals: string[];
    sourceRuleHits: Record<string, number>;
}

export function emptyHarmonySeedCollectionResult(): HarmonySeedCollectionResult {
    return {
        facts: [],
        seededLocals: [],
        sourceRuleHits: {},
    };
}

export function mergeHarmonySeedCollectionResults(
    results: HarmonySeedCollectionResult[]
): HarmonySeedCollectionResult {
    const factById = new Map<string, TaintFact>();
    const seededLocals = new Set<string>();
    const sourceRuleHits = new Map<string, number>();

    for (const result of results) {
        for (const fact of result.facts) {
            if (!factById.has(fact.id)) {
                factById.set(fact.id, fact);
            }
        }
        for (const seeded of result.seededLocals) {
            seededLocals.add(seeded);
        }
        for (const [ruleId, hitCount] of Object.entries(result.sourceRuleHits || {})) {
            sourceRuleHits.set(ruleId, (sourceRuleHits.get(ruleId) || 0) + hitCount);
        }
    }

    const sourceRuleHitsRecord: Record<string, number> = {};
    for (const [ruleId, hitCount] of [...sourceRuleHits.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
        sourceRuleHitsRecord[ruleId] = hitCount;
    }

    return {
        facts: [...factById.values()],
        seededLocals: [...seededLocals].sort(),
        sourceRuleHits: sourceRuleHitsRecord,
    };
}

