import type { AssetDocumentBase } from "../assets/schema";
import { lowerModuleAssetsToModuleRuntimeSpecs } from "../kernel/contracts/ModuleAssetLowering";
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
    const ruleLowering = lowerRuleAssetsToRuleSet(dedupedAssets, { includeGenerated: true });
    const moduleRuntimeSpecs = lowerLoadableCoreModuleAssets(dedupedAssets);
    return {
        assets: dedupedAssets,
        ruleSet: ruleLowering.ruleSet,
        moduleRuntimeSpecs,
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
        moduleRuntimeSpecs: augment.moduleRuntimeSpecs,
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

function lowerLoadableCoreModuleAssets(assets: AssetDocumentBase[]) {
    const loadable = assets.filter(asset =>
        asset.plane === "module"
        && (asset.status === "official"
            || asset.status === "reviewed"
            || asset.status === "replayed"
            || asset.status === "schema-valid"
            || asset.status === "llm-generated")
        && (asset.effectTemplates || []).some(template =>
            template.kind === "core.capability"
            || template.kind === "handoff.put"
            || template.kind === "handoff.get"
            || template.kind === "handoff.kill"
            || template.kind === "handoff.link",
        ),
    );
    return loadable.length > 0 ? lowerModuleAssetsToModuleRuntimeSpecs(loadable, { includeGenerated: true }) : [];
}
