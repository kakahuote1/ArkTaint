import * as fs from "fs";
import * as path from "path";
import { AssetDocumentBase } from "../../core/assets/schema";
import { loadRuleSet } from "../../core/rules/RuleLoader";
import { makeRuleAssetFixture } from "../helpers/RuleAssetFixtureFactory";

type RuleBundleKind = "sources" | "sinks" | "sanitizers" | "transfers";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

function readJson<T>(filePath: string): T {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
}

function countKinds(asset: AssetDocumentBase): Record<RuleBundleKind, number> {
    const counts: Record<RuleBundleKind, number> = {
        sources: 0,
        sinks: 0,
        sanitizers: 0,
        transfers: 0,
    };
    for (const binding of asset.bindings || []) {
        if (binding.role === "source") counts.sources++;
        if (binding.role === "sink") counts.sinks++;
        if (binding.role === "sanitizer") counts.sanitizers++;
        if (binding.role === "transfer") counts.transfers++;
    }
    return counts;
}

function writeRuleFile(filePath: string, payload: unknown): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf-8");
}

function verifyKindFirstRoot(kind: RuleBundleKind): void {
    const ruleCatalog = path.resolve("src/models");
    const kindDir = path.join(ruleCatalog, "kernel", "rules", kind);

    assert(fs.existsSync(kindDir), `missing kernel/rules/${kind} directory`);
    const memberFiles = fs.readdirSync(kindDir)
        .filter(name => name.endsWith(".rules.json"))
        .map(name => path.join(kindDir, name));
    assert(memberFiles.length > 0, `missing ${kind} kernel rule files`);

    for (const memberPath of memberFiles) {
        const asset = readJson<AssetDocumentBase>(memberPath);
        const counts = countKinds(asset);
        for (const [otherKind, count] of Object.entries(counts) as Array<[RuleBundleKind, number]>) {
            if (otherKind === kind) continue;
            assert(count === 0, `${path.basename(memberPath)} should not contain ${otherKind}`);
        }
    }
}

function writeRuleAsset(filePath: string, payload: ReturnType<typeof makeRuleAssetFixture>): void {
    writeRuleFile(filePath, payload);
}

function main(): void {
    verifyKindFirstRoot("sources");
    verifyKindFirstRoot("sinks");
    verifyKindFirstRoot("sanitizers");
    verifyKindFirstRoot("transfers");

    const probeRoot = path.resolve("tmp/test_runs/rule_bundle_kind_layout/latest/models");
    fs.rmSync(path.dirname(probeRoot), { recursive: true, force: true });
    writeRuleAsset(path.join(probeRoot, "kernel", "rules", "sources", "alpha.rules.json"), makeRuleAssetFixture({
        id: "asset.rule.layout.alpha",
        sources: [
            {
                id: "source.layout.alpha",
                sourceKind: "seed_local_name",
                match: { kind: "local_name_regex", value: "^layout_alpha$" },
                target: "result",
            },
        ],
    }));
    writeRuleAsset(path.join(probeRoot, "kernel", "rules", "sinks", "omega.rules.json"), makeRuleAssetFixture({
        id: "asset.rule.layout.omega",
        sinks: [
            {
                id: "sink.layout.omega",
                match: { kind: "method_name_equals", value: "SendLayout" },
            },
        ],
    }));
    writeRuleAsset(path.join(probeRoot, "kernel", "rules", "sanitizers", "gamma.rules.json"), makeRuleAssetFixture({
        id: "asset.rule.layout.gamma",
    }));
    writeRuleAsset(path.join(probeRoot, "kernel", "rules", "transfers", "beta.rules.json"), makeRuleAssetFixture({
        id: "asset.rule.layout.beta",
        transfers: [
            {
                id: "transfer.layout.beta",
                match: { kind: "method_name_equals", value: "BridgeLayout" },
                from: "arg0",
                to: "result",
            },
        ],
    }));

    const loaded = loadRuleSet({
        ruleCatalogPath: probeRoot,
    });
    assert(loaded.appliedLayerOrder.join(" -> ") === "kernel", "pack layout loading should keep kernel-only order by default");
    assert(loaded.ruleSet.sources.some(rule => rule.id === "source.layout.alpha"), "loader should accept arbitrary kernel source file names");
    assert(loaded.ruleSet.sinks.some(rule => rule.id === "sink.layout.omega"), "loader should accept arbitrary kernel sink file names");
    assert(loaded.ruleSet.transfers.some(rule => rule.id === "transfer.layout.beta"), "loader should accept arbitrary kernel transfer file names");

    console.log("PASS test_rule_bundle_kind_layout");
}

main();

