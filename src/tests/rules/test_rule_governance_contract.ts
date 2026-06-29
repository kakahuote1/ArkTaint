import * as fs from "fs";
import * as path from "path";
import { inferRuleFamily, normalizeRuleFamily, } from "../../core/rules/RuleFamily";
import { loadRuleSet } from "../../core/rules/RuleLoader";
import { validateRuleSet } from "../../core/rules/RuleValidator";
import { SinkRule, SourceRule, TransferRule } from "../../core/rules/RuleSchema";
import { makeRuleAssetFixture } from "../helpers/RuleAssetFixtureFactory";
import type { ApiEffectIdentity } from "../../core/api/ApiOccurrenceIdentity";
function assert(condition: unknown, message: string): asserts condition {
    if (!condition)
        throw new Error(message);
}
function ensureDir(dir: string): void {
    if (!fs.existsSync(dir))
        fs.mkdirSync(dir, { recursive: true });
}
function writeJson(filePath: string, value: unknown): void {
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf-8");
}
function apiEffect(id: string, role: ApiEffectIdentity["role"]): ApiEffectIdentity {
    return {
        canonicalApiId: `api:test:${id}`,
        assetId: `asset.${id}`,
        surfaceId: `surface.${id}`,
        bindingId: `binding.${id}`,
        effectTemplateId: `template.${id}`,
        role,
    };
}
async function main(): Promise<void> {
    const exactSourceEffect = apiEffect("family.contract.source.exact", "source");
    const exactSource: SourceRule = {
        id: "family.contract.source.exact",
        match: { kind: "canonical_api_id_equals", value: exactSourceEffect.canonicalApiId },
        apiEffect: exactSourceEffect,
        sourceKind: "call_return",
        target: "result",
    };
    const normalizedExactSource = normalizeRuleFamily(exactSource, { kind: "builtin_kernel_json" }, "source");
    assert(normalizedExactSource.family === "api.source.asset_family_contract_source_exact.binding_family_contract_source_exact", "exact source should infer stable apiEffect family");
    const sinkEffect = apiEffect("family.contract.sink.method", "sink");
    const sink: SinkRule = {
        id: "family.contract.sink.method",
        match: { kind: "canonical_api_id_equals", value: sinkEffect.canonicalApiId },
        apiEffect: sinkEffect,
    };
    const normalizedSink = normalizeRuleFamily(sink, { kind: "llm_candidate_json" }, "sink");
    assert(normalizedSink.family === "api.sink.asset_family_contract_sink_method.binding_family_contract_sink_method", "sink should infer apiEffect family");
    const transferEffect = apiEffect("family.contract.transfer.explicit", "transfer");
    const explicitTransfer: TransferRule = {
        id: "family.contract.transfer.explicit",
        family: "transfer.explicit.anchor",
        match: { kind: "canonical_api_id_equals", value: transferEffect.canonicalApiId },
        apiEffect: transferEffect,
        from: "arg1",
        to: "base",
    };
    const normalizedTransfer = normalizeRuleFamily(explicitTransfer, { kind: "external_project_json" }, "transfer");
    assert(normalizedTransfer.family === "transfer.explicit.anchor", "explicit family must be preserved");
    const sameSourceAgain = normalizeRuleFamily(exactSource, { kind: "external_project_json" }, "source");
    assert(sameSourceAgain.family === normalizedExactSource.family, "same authored rule should keep the same family across origins");
    const canonicalEffect = apiEffect("family.contract.source.canonical", "source");
    const canonicalRule: SourceRule = {
        id: "family.contract.source.canonical",
        sourceKind: "call_return",
        target: "result",
        match: {
            kind: "canonical_api_id_equals",
            value: canonicalEffect.canonicalApiId,
        },
        apiEffect: canonicalEffect,
    };
    const normalizedCanonicalRule = normalizeRuleFamily(canonicalRule, { kind: "llm_candidate_json" }, "source");
    assert(inferRuleFamily(canonicalRule, { kind: "llm_candidate_json" }, "source")
        === normalizedCanonicalRule.family, "family inference should be deterministic");
    const obsoletePriorityFieldResult = validateRuleSet({
        sinks: [{
                id: "sink.obsolete.priority",
                match: { kind: "canonical_api_id_equals", value: "api:test:obsolete" },
                apiEffect: apiEffect("obsolete", "sink"),
                ["ti" + "er"]: "A",
            } as any],
        sources: [],
        transfers: [],
    });
    assert(!obsoletePriorityFieldResult.valid
        && obsoletePriorityFieldResult.errors.some(error => error.includes("obsolete") && error.includes("priority field")), "obsolete priority fields must be rejected");
    const obsoleteSelectorKind = ["method", "name", "equals"].join("_");
    const unanchoredMethodResult = validateRuleSet({
        sinks: [{
                id: "sink.unanchored.method",
                match: { kind: obsoleteSelectorKind, value: "Sink" } as any,
            }],
        sources: [],
        transfers: [],
    });
    assert(!unanchoredMethodResult.valid
        && unanchoredMethodResult.errors.some(error => error.includes("match.kind is invalid")), "legacy method-name selectors must be rejected");
    const changedMethod: SourceRule = {
        ...exactSource,
        id: "family.contract.source.exact.changed",
        match: { kind: "canonical_api_id_equals", value: apiEffect("family.contract.source.changed", "source").canonicalApiId },
        apiEffect: apiEffect("family.contract.source.changed", "source"),
    };
    const normalizedChangedMethod = normalizeRuleFamily(changedMethod, { kind: "builtin_kernel_json" }, "source");
    assert(normalizedChangedMethod.family !== normalizedExactSource.family, "family derivation should distinguish different API anchors");
    const tmpDir = path.resolve("tmp/test_runs/rule_family_contract/latest");
    ensureDir(tmpDir);
    const extraRulePath = path.join(tmpDir, "extra.rules.json");
    writeJson(extraRulePath, makeRuleAssetFixture({
        id: "asset.rule.family.extra",
        sources: [{
                id: "source.extra.project.only",
                surface: {
                    kind: "signature",
                    signatureId: "extra_fixture.ets: Extra.extraEntry(SyntheticArg0)",
                    invokeKind: "static",
                    argCount: 1,
                    scope: { file: { mode: "equals", value: "extra_fixture.ets" } }
                },
                sourceKind: "entry_param",
                target: "arg0"
            }]
    }));
    const loaded = loadRuleSet({
        kernelRulePath: path.resolve("tests/rules/minimal.rules.json"),
        extraRulePaths: [extraRulePath],
    });
    const extraSource = loaded.ruleSet.sources.find(rule => rule.id === "source.extra.project.only");
    assert(!!extraSource, "extra source rule should be loaded");
    assert(typeof extraSource!.family === "string" && extraSource!.family.trim().length > 0, "extra source rule should carry family");
    console.log("====== Rule Family Contract ======");
    console.log("explicit_family_preservation=PASS");
    console.log("auto_family_stability=PASS");
    console.log("obsolete_priority_rejection=PASS");
    console.log("extra_rule_path_family=PASS");
}
main().catch(error => {
    console.error("FAIL test_rule_governance_contract");
    console.error(error);
    process.exit(1);
});
