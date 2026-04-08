import * as fs from "fs";
import * as path from "path";
import { RuleLoadError, loadRuleSet } from "../../core/rules/RuleLoader";
import { createIsolatedRunDir } from "../helpers/ExecutionHandoffContractSupport";

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

function writeRuleFile(filePath: string, payload: unknown): void {
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf-8");
}

function makeEmptyRuleSet(kind: "sources" | "sinks" | "sanitizers" | "transfers", items: unknown[]): Record<string, unknown> {
    return {
        schemaVersion: "2.0",
        sources: kind === "sources" ? items : [],
        sinks: kind === "sinks" ? items : [],
        sanitizers: kind === "sanitizers" ? items : [],
        transfers: kind === "transfers" ? items : [],
    };
}

async function main(): Promise<void> {
    const root = path.join(
        createIsolatedRunDir(path.resolve("tmp/test_runs/rule_project_pack_loading/latest"), "ruleset"),
        "rules",
    );

    writeRuleFile(
        path.join(root, "sources", "kernel", "seed.rules.json"),
        makeEmptyRuleSet("sources", [
            {
                id: "source.kernel.seed",
                match: { kind: "local_name_regex", value: "^kernel_seed$" },
                sourceKind: "seed_local_name",
                target: "result",
            },
        ]),
    );
    writeRuleFile(
        path.join(root, "sinks", "kernel", "send.rules.json"),
        makeEmptyRuleSet("sinks", [
            {
                id: "sink.kernel.send",
                match: { kind: "method_name_equals", value: "sendKernel" },
            },
        ]),
    );
    writeRuleFile(
        path.join(root, "sanitizers", "kernel", "sanitize.rules.json"),
        makeEmptyRuleSet("sanitizers", []),
    );
    writeRuleFile(
        path.join(root, "transfers", "kernel", "flow.rules.json"),
        makeEmptyRuleSet("transfers", [
            {
                id: "transfer.kernel.base_to_result",
                match: { kind: "method_name_equals", value: "kernelTransfer", invokeKind: "instance", argCount: 1 },
                from: "base",
                to: "result",
            },
        ]),
    );

    writeRuleFile(
        path.join(root, "sources", "project", "sdk_alpha", "alpha.rules.json"),
        makeEmptyRuleSet("sources", [
            {
                id: "source.project.alpha",
                match: { kind: "local_name_regex", value: "^alpha_seed$" },
                sourceKind: "seed_local_name",
                target: "result",
            },
        ]),
    );
    writeRuleFile(
        path.join(root, "transfers", "project", "sdk_alpha", "alpha.rules.json"),
        makeEmptyRuleSet("transfers", [
            {
                id: "transfer.project.alpha",
                match: { kind: "method_name_equals", value: "alphaTransfer", invokeKind: "instance", argCount: 1 },
                from: "arg0",
                to: "result",
            },
        ]),
    );
    writeRuleFile(
        path.join(root, "sinks", "project", "sdk_beta", "beta.rules.json"),
        makeEmptyRuleSet("sinks", [
            {
                id: "sink.project.beta",
                match: { kind: "method_name_equals", value: "betaSend" },
            },
        ]),
    );

    const kernelOnly = loadRuleSet({ ruleCatalogPath: root });
    assert(kernelOnly.appliedLayerOrder.join(" -> ") === "kernel", "packs should not auto-load by default");
    assert(kernelOnly.discoveredRulePacks.join(",") === "sdk_alpha,sdk_beta", "project packs should be discovered");
    assert(kernelOnly.enabledRulePacks.length === 0, "no project pack should be enabled by default");
    assert(!kernelOnly.ruleSet.sources.some(rule => rule.id === "source.project.alpha"), "alpha pack should stay disabled by default");
    assert(!kernelOnly.ruleSet.sinks.some(rule => rule.id === "sink.project.beta"), "beta pack should stay disabled by default");

    const alphaEnabled = loadRuleSet({
        ruleCatalogPath: root,
        enabledRulePacks: ["sdk_alpha"],
    });
    assert(alphaEnabled.appliedLayerOrder.join(" -> ") === "kernel -> project", "enabled pack should add project layer");
    assert(alphaEnabled.ruleSet.sources.some(rule => rule.id === "source.project.alpha"), "enabled alpha pack source should load");
    assert(alphaEnabled.ruleSet.transfers.some(rule => rule.id === "transfer.project.alpha"), "enabled alpha pack transfer should load");
    assert(!alphaEnabled.ruleSet.sinks.some(rule => rule.id === "sink.project.beta"), "disabled beta pack should stay absent");
    assert(
        alphaEnabled.layerStatus.some(status => status.name === "project" && status.packId === "sdk_alpha" && status.applied),
        "alpha pack should appear as applied project layer status",
    );

    const betaOnly = loadRuleSet({
        ruleCatalogPath: root,
        enabledRulePacks: ["sdk_alpha", "sdk_beta"],
        disabledRulePacks: ["sdk_alpha"],
    });
    assert(!betaOnly.ruleSet.sources.some(rule => rule.id === "source.project.alpha"), "disabled alpha pack should be removed");
    assert(betaOnly.ruleSet.sinks.some(rule => rule.id === "sink.project.beta"), "beta pack should remain enabled");

    let missingPackError: RuleLoadError | undefined;
    try {
        loadRuleSet({
            ruleCatalogPath: root,
            enabledRulePacks: ["missing_pack"],
        });
    } catch (error) {
        missingPackError = error as RuleLoadError;
    }
    assert(missingPackError instanceof RuleLoadError, "missing project pack should throw RuleLoadError");
    assert(
        missingPackError.issues[0]?.message.includes("project rule pack not found"),
        "missing project pack should surface a readable error",
    );

    console.log("====== Rule Project Pack Loading ======");
    console.log("pack_default_disabled=PASS");
    console.log("pack_enable=PASS");
    console.log("pack_disable_override=PASS");
    console.log("pack_missing_error=PASS");
}

main().catch(error => {
    console.error("FAIL test_rule_project_pack_loading");
    console.error(error);
    process.exit(1);
});
