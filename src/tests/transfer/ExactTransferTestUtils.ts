import type { AssetDocumentBase, AssetIdentityIndex } from "../../core/assets/schema";
import type { PagNode } from "../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import type { Scene } from "../../../arkanalyzer/out/src/Scene";
import type { CanonicalApiRegistry } from "../../core/api/identity";
import type { SinkRule, SourceRule, TransferRule } from "../../core/rules/RuleSchema";
import type { TaintPropagationEngine } from "../../core/orchestration/TaintPropagationEngine";
import {
    exactRuleRuntimeFromAssets,
    exactRuleRuntimeFromFixtures,
    type ExactRuleFixture,
    type ExactRuleRuntime,
} from "../rules/ExactRuleTestUtils";

export type TransferTestRule = SourceRule | SinkRule | TransferRule;

export type TransferTestFixture =
    | ExactRuleFixture<SourceRule>
    | ExactRuleFixture<SinkRule>
    | ExactRuleFixture<TransferRule>;

export function exactTransferRuntimeFromFixtures(fixtures: TransferTestFixture[]): ExactRuleRuntime {
    return exactRuleRuntimeFromFixtures(fixtures);
}

export function exactTransferRuntimeFromAssets(apiAssets: AssetDocumentBase[]): ExactRuleRuntime {
    return exactRuleRuntimeFromAssets(apiAssets);
}

export function exactTransferRuntimeFromLoaded(input: {
    assets: AssetDocumentBase[];
    canonicalApiRegistry: CanonicalApiRegistry;
    assetIdentityIndex: AssetIdentityIndex;
}): ExactRuleRuntime {
    return {
        apiAssets: input.assets,
        canonicalApiRegistry: input.canonicalApiRegistry,
        assetIdentityIndex: input.assetIdentityIndex,
    };
}

export function exactTransferRuntimeFromLoadedAndFixtures(
    input: { assets: AssetDocumentBase[] },
    fixtures: TransferTestFixture[],
): ExactRuleRuntime {
    return exactRuleRuntimeFromAssets(
        [
            ...input.assets,
            ...fixtures.map(fixture => fixture.asset),
        ],
        fixtures.map(fixture => fixture.exact.canonicalApiDescriptor),
    );
}

export function canonicalApiIdMatch(rule: TransferTestRule): { kind: "canonical_api_id_equals"; value: string } {
    return { kind: "canonical_api_id_equals", value: rule.apiEffect.canonicalApiId };
}

export function assertCanonicalExactRules(rules: TransferTestRule[]): void {
    for (const rule of rules) {
        assert(rule.match.kind === "canonical_api_id_equals", `${rule.id} must use canonical API identity`);
        assert(
            rule.match.value === rule.apiEffect.canonicalApiId,
            `${rule.id} match value must equal apiEffect.canonicalApiId`,
        );
    }
}

export function findLocalSeedNodes(
    engine: TaintPropagationEngine,
    scene: Scene,
    methodName: string,
    localName: string,
): PagNode[] {
    const method = scene.getMethods().find(m => m.getName() === methodName);
    assert(method, `method not found: ${methodName}`);
    const local = method.getBody?.()?.getLocals?.()?.get(localName);
    if (local) {
        const nodeIds = engine.pag.getNodesByValue(local);
        if (nodeIds) return [...nodeIds.values()].map(id => engine.pag.getNode(id) as PagNode);
    }
    const cfg = method.getCfg();
    assert(cfg, `cfg not found: ${methodName}`);
    for (const stmt of cfg.getStmts()) {
        const left = (stmt as any).getLeftOp?.();
        if (!left || left.getName?.() !== localName) continue;
        const nodeIds = engine.pag.getNodesByValue(left);
        return nodeIds ? [...nodeIds.values()].map(id => engine.pag.getNode(id) as PagNode) : [];
    }
    return [];
}

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}
