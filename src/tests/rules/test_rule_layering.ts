import * as path from "path";
import { loadRuleSet } from "../../core/rules/RuleLoader";

function assert(condition: boolean, message: string): void {
    if (!condition) {
        throw new Error(message);
    }
}

async function main(): Promise<void> {
    const baseDir = path.resolve("tests/rules/layer_priority");
    const loaded = loadRuleSet({
        kernelRulePath: path.join(baseDir, "kernel.rules.json"),
        projectRulePath: path.join(baseDir, "project.rules.json"),
        candidateRulePath: path.join(baseDir, "llm_candidate.rules.json"),
    });

    const order = loaded.appliedLayerOrder.join(" -> ");
    assert(
        order === "kernel -> project",
        `unexpected applied layer order: ${order}`,
    );

    const transferSame = loaded.ruleSet.transfers.find(r => r.id === "transfer.layer.same");
    assert(!!transferSame, "missing transfer.layer.same");
    assert(transferSame!.from === "result" && transferSame!.to === "arg0", "transfer.layer.same not overridden by llm layer");
    assert(transferSame!.layer === "project", "transfer.layer.same should carry project layer");
    assert(typeof transferSame!.family === "string" && transferSame!.family.startsWith("auto.transfer.transfer."), "transfer.layer.same should carry auto family");
    assert(transferSame!.tier === "C", "transfer.layer.same should infer tier C from unanchored method_name_equals");

    const sourceSame = loaded.ruleSet.sources.find(r => r.id === "source.layer.same");
    assert(!!sourceSame, "missing source.layer.same");
    assert(sourceSame!.match.value === "llm_src", "source.layer.same not overridden by llm layer");
    assert(sourceSame!.layer === "project", "source.layer.same should carry project layer");
    assert(typeof sourceSame!.family === "string" && sourceSame!.family.startsWith("auto.source.seed_local_name."), "source.layer.same should carry auto source family");
    assert(sourceSame!.tier === "C", "source.layer.same should infer tier C in llm candidate origin");

    const sinkSame = loaded.ruleSet.sinks.find(r => r.id === "sink.layer.same");
    assert(!!sinkSame, "missing sink.layer.same");
    assert(sinkSame!.match.value === "llm_sink", "sink.layer.same not overridden by llm layer");
    assert(sinkSame!.layer === "project", "sink.layer.same should carry project layer");
    assert(typeof sinkSame!.family === "string" && sinkSame!.family.startsWith("auto.sink.sink."), "sink.layer.same should carry auto sink family");
    assert(sinkSame!.tier === "C", "sink.layer.same should infer tier C in llm candidate origin");

    const defaultOnly = loaded.ruleSet.sources.find(r => r.id === "source.layer.default_only");
    const projectOnly = loaded.ruleSet.sources.find(r => r.id === "source.layer.project_only");
    const llmOnly = loaded.ruleSet.sources.find(r => r.id === "source.layer.llm_only");
    assert(defaultOnly?.layer === "kernel", "default-only source should carry kernel layer");
    assert(projectOnly?.layer === "project", "project-only source should carry project layer");
    assert(llmOnly?.layer === "project", "llm-only source should carry project layer");

    const layeredSourceCount = loaded.ruleSet.sources.filter(r => r.id.startsWith("source.layer.")).length;
    assert(layeredSourceCount === 4, `unexpected layer fixture source count: ${layeredSourceCount}`);
    assert(loaded.ruleSet.sinks.length === 4, `unexpected sink count: ${loaded.ruleSet.sinks.length}`);
    assert(loaded.ruleSet.transfers.length === 4, `unexpected transfer count: ${loaded.ruleSet.transfers.length}`);

    console.log("====== Rule Layering Test ======");
    console.log(`applied_layers=${order}`);
    console.log(`sources=${layeredSourceCount}`);
    console.log(`sinks=${loaded.ruleSet.sinks.length}`);
    console.log(`transfers=${loaded.ruleSet.transfers.length}`);
    console.log("layering_precedence=PASS");
}

main().catch(err => {
    console.error(err);
    process.exitCode = 1;
});
