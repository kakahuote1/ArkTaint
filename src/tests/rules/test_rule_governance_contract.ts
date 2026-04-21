import * as fs from "fs";
import * as path from "path";
import {
    inferRuleLayer,
    normalizeRuleGovernance,
} from "../../core/rules/RuleGovernance";
import { loadRuleSet } from "../../core/rules/RuleLoader";
import { SinkRule, SourceRule, TransferRule } from "../../core/rules/RuleSchema";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

function ensureDir(dir: string): void {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function writeJson(filePath: string, value: unknown): void {
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf-8");
}

async function main(): Promise<void> {
    assert(inferRuleLayer({ kind: "builtin_kernel_json" }) === "kernel", "builtin_kernel_json should map to kernel");
    assert(inferRuleLayer({ kind: "kernel_callback_catalog" }) === "kernel", "kernel_callback_catalog should map to kernel");
    assert(inferRuleLayer({ kind: "kernel_api_catalog" }) === "kernel", "kernel_api_catalog should map to kernel");
    assert(inferRuleLayer({ kind: "entry_contract" }) === "kernel", "entry_contract should map to kernel");
    assert(inferRuleLayer({ kind: "builtin_project_pack_json" }) === "project", "builtin_project_pack_json should map to project");
    assert(inferRuleLayer({ kind: "external_project_json" }) === "project", "external_project_json should map to project");
    assert(inferRuleLayer({ kind: "user_project_extra_json" }) === "project", "user_project_extra_json should map to project");
    assert(inferRuleLayer({ kind: "llm_candidate_json" }) === "project", "llm_candidate_json should map to project");

    const exactSource: SourceRule = {
        id: "governance.contract.source.exact",
        match: { kind: "signature_equals", value: "@ohos.router.Router.getParams" },
        sourceKind: "call_return",
        target: "result",
    };
    const normalizedExactSource = normalizeRuleGovernance(exactSource, { kind: "builtin_kernel_json" }, "source");
    assert(normalizedExactSource.layer === "kernel", "exact kernel source should carry kernel layer");
    assert(normalizedExactSource.tier === "A", "signature_equals source should infer tier A");
    assert(
        typeof normalizedExactSource.family === "string" && normalizedExactSource.family === "auto.source.call_return.method.getparams",
        "exact source should infer stable auto family",
    );

    const weakSink: SinkRule = {
        id: "governance.contract.sink.weak",
        match: { kind: "method_name_equals", value: "send" },
    };
    const normalizedWeakSink = normalizeRuleGovernance(weakSink, { kind: "llm_candidate_json" }, "sink");
    assert(normalizedWeakSink.layer === "project", "candidate sink should carry project layer");
    assert(normalizedWeakSink.tier === "C", "candidate sink should default to tier C");
    assert(
        typeof normalizedWeakSink.family === "string" && normalizedWeakSink.family === "auto.sink.sink.method.send",
        "candidate sink should infer auto sink family",
    );

    const anchoredTransfer: TransferRule = {
        id: "governance.contract.transfer.anchored",
        family: "transfer.explicit.anchor",
        tier: "B",
        match: { kind: "method_name_equals", value: "putSync", invokeKind: "instance", argCount: 2 },
        from: "arg1",
        to: "base",
    };
    const normalizedAnchoredTransfer = normalizeRuleGovernance(anchoredTransfer, { kind: "external_project_json" }, "transfer");
    assert(normalizedAnchoredTransfer.layer === "project", "project transfer should carry project layer");
    assert(normalizedAnchoredTransfer.family === "transfer.explicit.anchor", "explicit family must be preserved");
    assert(normalizedAnchoredTransfer.tier === "B", "explicit tier must be preserved");

    const sameSourceAgain = normalizeRuleGovernance(exactSource, { kind: "builtin_kernel_json" }, "source");
    assert(
        sameSourceAgain.family === normalizedExactSource.family,
        "same rule normalized twice should produce stable family",
    );

    const sameSourceFromProject = normalizeRuleGovernance(exactSource, { kind: "external_project_json" }, "source");
    assert(sameSourceFromProject.layer === "project", "same authored source should map to project layer under project origin");
    assert(
        sameSourceFromProject.family === normalizedExactSource.family,
        "same authored rule should keep the same family across framework/project origins",
    );

    const weakerMethodRule: SourceRule = {
        id: "governance.contract.source.method_fallback",
        sourceKind: "call_return",
        target: "result",
        match: { kind: "method_name_equals", value: "getParams" },
    };
    const normalizedWeakerMethodRule = normalizeRuleGovernance(weakerMethodRule, { kind: "llm_candidate_json" }, "source");
    assert(
        normalizedWeakerMethodRule.family === normalizedExactSource.family,
        "strong exact rule and weak method fallback for the same API should share family",
    );
    assert(normalizedWeakerMethodRule.tier === "C", "weak method fallback should infer tier C");

    const changedMethod: SourceRule = {
        ...exactSource,
        id: "governance.contract.source.exact.changed",
        match: { kind: "signature_equals", value: "@ohos.router.Router.back" },
    };
    const normalizedChangedMethod = normalizeRuleGovernance(changedMethod, { kind: "builtin_kernel_json" }, "source");
    assert(
        normalizedChangedMethod.family !== normalizedExactSource.family,
        "family derivation should distinguish different API anchors",
    );

    const tmpDir = path.resolve("tmp/test_runs/rule_governance_contract/latest");
    ensureDir(tmpDir);
    const extraRulePath = path.join(tmpDir, "extra.rules.json");
    writeJson(extraRulePath, {
        schemaVersion: "2.0",
        sources: [
            {
                id: "source.extra.project.only",
                match: { kind: "local_name_regex", value: "^extra_source$" },
                sourceKind: "seed_local_name",
                target: "result",
            },
        ],
        sinks: [],
        transfers: [],
    });

    const loaded = loadRuleSet({
        kernelRulePath: path.resolve("tests/rules/minimal.rules.json"),
        extraRulePaths: [extraRulePath],
    });
    const extraSource = loaded.ruleSet.sources.find(rule => rule.id === "source.extra.project.only");
    assert(!!extraSource, "extra source rule should be loaded");
    assert(extraSource!.layer === "project", "extraRulePaths should normalize to project layer");
    assert(extraSource!.tier === "B", "project regex source should infer tier B");
    assert(
        typeof extraSource!.family === "string" && extraSource!.family.startsWith("auto.source.seed_local_name.local_re."),
        "extra source rule should receive auto family",
    );

    console.log("====== Rule Governance Contract ======");
    console.log("origin_layer_mapping=PASS");
    console.log("explicit_override_preservation=PASS");
    console.log("auto_family_stability=PASS");
    console.log("extra_rule_path_project_layer=PASS");
}

main().catch(error => {
    console.error("FAIL test_rule_governance_contract");
    console.error(error);
    process.exit(1);
});
