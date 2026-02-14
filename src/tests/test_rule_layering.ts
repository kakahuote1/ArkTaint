import * as path from "path";
import { loadRuleSet } from "../core/rules/RuleLoader";

function assert(condition: boolean, message: string): void {
    if (!condition) {
        throw new Error(message);
    }
}

async function main(): Promise<void> {
    const baseDir = path.resolve("tests/rules/layer_priority");
    const loaded = loadRuleSet({
        defaultRulePath: path.join(baseDir, "default.rules.json"),
        frameworkRulePath: path.join(baseDir, "framework.rules.json"),
        projectRulePath: path.join(baseDir, "project.rules.json"),
        llmCandidateRulePath: path.join(baseDir, "llm_candidate.rules.json"),
        autoDiscoverLayers: false,
    });

    const order = loaded.appliedLayerOrder.join(" -> ");
    assert(
        order === "default -> framework -> project -> llm_candidate",
        `unexpected applied layer order: ${order}`
    );

    const transferSame = loaded.ruleSet.transfers.find(r => r.id === "transfer.layer.same");
    assert(!!transferSame, "missing transfer.layer.same");
    assert(transferSame!.from === "result" && transferSame!.to === "arg0", "transfer.layer.same not overridden by llm layer");

    const sourceSame = loaded.ruleSet.sources.find(r => r.id === "source.layer.same");
    assert(!!sourceSame, "missing source.layer.same");
    assert(sourceSame!.match.value === "llm_src", "source.layer.same not overridden by llm layer");

    const sinkSame = loaded.ruleSet.sinks.find(r => r.id === "sink.layer.same");
    assert(!!sinkSame, "missing sink.layer.same");
    assert(sinkSame!.match.value === "llm_sink", "sink.layer.same not overridden by llm layer");

    assert(loaded.ruleSet.sources.length === 5, `unexpected source count: ${loaded.ruleSet.sources.length}`);
    assert(loaded.ruleSet.sinks.length === 5, `unexpected sink count: ${loaded.ruleSet.sinks.length}`);
    assert(loaded.ruleSet.transfers.length === 5, `unexpected transfer count: ${loaded.ruleSet.transfers.length}`);

    console.log("====== Rule Layering Test ======");
    console.log(`applied_layers=${order}`);
    console.log(`sources=${loaded.ruleSet.sources.length}`);
    console.log(`sinks=${loaded.ruleSet.sinks.length}`);
    console.log(`transfers=${loaded.ruleSet.transfers.length}`);
    console.log("layering_precedence=PASS");
}

main().catch(err => {
    console.error(err);
    process.exitCode = 1;
});
