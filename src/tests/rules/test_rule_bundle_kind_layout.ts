import * as fs from "fs";
import * as path from "path";
import { loadRuleSet } from "../../core/rules/RuleLoader";
import { TaintRuleSet } from "../../core/rules/RuleSchema";

type RuleBundleKind = "sources" | "sinks" | "sanitizers" | "transfers";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

function readJson<T>(filePath: string): T {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
}

function countKinds(ruleSet: TaintRuleSet): Record<RuleBundleKind, number> {
    return {
        sources: (ruleSet.sources || []).length,
        sinks: (ruleSet.sinks || []).length,
        sanitizers: (ruleSet.sanitizers || []).length,
        transfers: (ruleSet.transfers || []).length,
    };
}

function writeRuleFile(filePath: string, payload: unknown): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf-8");
}

function verifyKindFirstRoot(kind: RuleBundleKind): void {
    const ruleCatalog = path.resolve("src/rules");
    const kindDir = path.join(ruleCatalog, kind);
    const kernelDir = path.join(kindDir, "kernel");
    const projectDir = path.join(kindDir, "project");

    assert(fs.existsSync(kernelDir), `missing ${kind}/kernel directory`);
    assert(fs.existsSync(projectDir), `missing ${kind}/project directory`);
    const memberFiles = fs.readdirSync(kernelDir)
        .filter(name => name.endsWith(".rules.json"))
        .map(name => path.join(kernelDir, name));
    assert(memberFiles.length > 0, `missing ${kind} kernel rule files`);

    for (const memberPath of memberFiles) {
        const ruleSet = readJson<TaintRuleSet>(memberPath);
        const counts = countKinds(ruleSet);
        for (const [otherKind, count] of Object.entries(counts) as Array<[RuleBundleKind, number]>) {
            if (otherKind === kind) continue;
            assert(count === 0, `${path.basename(memberPath)} should not contain ${otherKind}`);
        }
    }
}

function main(): void {
    verifyKindFirstRoot("sources");
    verifyKindFirstRoot("sinks");
    verifyKindFirstRoot("sanitizers");
    verifyKindFirstRoot("transfers");

    const probeRoot = path.resolve("tmp/test_runs/rule_bundle_kind_layout/latest/rules");
    fs.rmSync(path.dirname(probeRoot), { recursive: true, force: true });
    writeRuleFile(path.join(probeRoot, "sources", "kernel", "alpha.rules.json"), {
        schemaVersion: "2.0",
        sources: [
            {
                id: "source.layout.alpha",
                sourceKind: "seed_local_name",
                match: { kind: "local_name_regex", value: "^layout_alpha$" },
                target: "result",
            },
        ],
        sinks: [],
        sanitizers: [],
        transfers: [],
    });
    writeRuleFile(path.join(probeRoot, "sinks", "kernel", "omega.rules.json"), {
        schemaVersion: "2.0",
        sources: [],
        sinks: [
            {
                id: "sink.layout.omega",
                match: { kind: "method_name_equals", value: "SendLayout" },
            },
        ],
        sanitizers: [],
        transfers: [],
    });
    writeRuleFile(path.join(probeRoot, "sanitizers", "kernel", "gamma.rules.json"), {
        schemaVersion: "2.0",
        sources: [],
        sinks: [],
        sanitizers: [],
        transfers: [],
    });
    writeRuleFile(path.join(probeRoot, "transfers", "kernel", "beta.rules.json"), {
        schemaVersion: "2.0",
        sources: [],
        sinks: [],
        sanitizers: [],
        transfers: [
            {
                id: "transfer.layout.beta",
                match: { kind: "method_name_equals", value: "BridgeLayout" },
                from: "arg0",
                to: "result",
            },
        ],
    });

    const loaded = loadRuleSet({
        ruleCatalogPath: probeRoot,
    });
    assert(loaded.appliedLayerOrder.join(" -> ") === "kernel", "kind-first root loading should keep kernel-only order by default");
    assert(loaded.ruleSet.sources.some(rule => rule.id === "source.layout.alpha"), "loader should accept arbitrary kernel source file names");
    assert(loaded.ruleSet.sinks.some(rule => rule.id === "sink.layout.omega"), "loader should accept arbitrary kernel sink file names");
    assert(loaded.ruleSet.transfers.some(rule => rule.id === "transfer.layout.beta"), "loader should accept arbitrary kernel transfer file names");

    console.log("PASS test_rule_bundle_kind_layout");
}

main();
