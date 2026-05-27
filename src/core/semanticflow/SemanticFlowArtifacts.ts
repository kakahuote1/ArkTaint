import type { AssetDocumentBase } from "../assets/schema";
import { lowerRuleAssetsToRuleSet } from "../rules/RuleAssetLowering";
import type { TaintRuleSet } from "../rules/RuleSchema";
import type {
    SemanticFlowAnalysisAugment,
    SemanticFlowEngineAugment,
    SemanticFlowItemResult,
} from "./SemanticFlowTypes";

export function buildSemanticFlowAnalysisAugment(items: SemanticFlowItemResult[]): SemanticFlowAnalysisAugment {
    return buildSemanticFlowAnalysisAugmentFromAssets(
        items.map(item => item.asset).filter((item): item is AssetDocumentBase => !!item),
    );
}

export function buildSemanticFlowAnalysisAugmentFromAssets(assets: AssetDocumentBase[]): SemanticFlowAnalysisAugment {
    const dedupedAssets = dedupeAssets(assets);
    const ruleLowering = lowerRuleAssetsToRuleSet(dedupedAssets);
    return {
        assets: dedupedAssets,
        ruleSet: ruleLowering.ruleSet,
    };
}

export function mergeSemanticFlowAnalysisAugments(
    augments: SemanticFlowAnalysisAugment[],
): SemanticFlowAnalysisAugment {
    return buildSemanticFlowAnalysisAugmentFromAssets(augments.flatMap(augment => augment.assets || []));
}

export function consolidateSemanticFlowAnalysisAugmentByFootprint(
    augment: SemanticFlowAnalysisAugment,
): SemanticFlowAnalysisAugment {
    return buildSemanticFlowAnalysisAugmentFromAssets(augment.assets || []);
}

export function buildSemanticFlowEngineAugment(augment: SemanticFlowAnalysisAugment): SemanticFlowEngineAugment {
    return {
        sourceRules: augment.ruleSet.sources || [],
        sinkRules: augment.ruleSet.sinks || [],
        sanitizerRules: augment.ruleSet.sanitizers || [],
        transferRules: augment.ruleSet.transfers || [],
    };
}

export function mergeRuleSets(left: TaintRuleSet, right: TaintRuleSet): TaintRuleSet {
    return {
        sources: [...(left.sources || []), ...(right.sources || [])],
        sinks: [...(left.sinks || []), ...(right.sinks || [])],
        sanitizers: [...(left.sanitizers || []), ...(right.sanitizers || [])],
        transfers: [...(left.transfers || []), ...(right.transfers || [])],
    };
}

function dedupeAssets(assets: AssetDocumentBase[]): AssetDocumentBase[] {
    const byKey = new Map<string, AssetDocumentBase>();
    for (const asset of assets) {
        const key = `${asset.plane}:${asset.id}`;
        if (!byKey.has(key)) {
            byKey.set(key, asset);
        }
    }
    return [...byKey.values()];
}
