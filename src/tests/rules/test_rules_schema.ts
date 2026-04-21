import * as path from "path";
import { loadRuleSet, summarizeRuleSet, summarizeSanitizerTargets, summarizeTransferEndpoints } from "../../core/rules/RuleLoader";

interface CliOptions {
    kernelRulePath?: string;
    ruleCatalogPath?: string;
    projectRulePath?: string;
    candidateRulePath?: string;
    autoDiscoverLayers?: boolean;
    allowMissingProject?: boolean;
    allowMissingCandidate?: boolean;
}

function parseArgs(argv: string[]): CliOptions {
    const out: CliOptions = {
        autoDiscoverLayers: true,
    };

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--kernelRule" && i + 1 < argv.length) {
            out.kernelRulePath = argv[++i];
            continue;
        }
        if (arg.startsWith("--kernelRule=")) {
            out.kernelRulePath = arg.slice("--kernelRule=".length);
            continue;
        }
        if (arg === "--ruleCatalog" && i + 1 < argv.length) {
            out.ruleCatalogPath = argv[++i];
            continue;
        }
        if (arg.startsWith("--ruleCatalog=")) {
            out.ruleCatalogPath = arg.slice("--ruleCatalog=".length);
            continue;
        }
        if (arg === "--project" && i + 1 < argv.length) {
            out.projectRulePath = argv[++i];
            continue;
        }
        if (arg.startsWith("--project=")) {
            out.projectRulePath = arg.slice("--project=".length);
            continue;
        }
        if (arg === "--candidate" && i + 1 < argv.length) {
            out.candidateRulePath = argv[++i];
            continue;
        }
        if (arg.startsWith("--candidate=")) {
            out.candidateRulePath = arg.slice("--candidate=".length);
            continue;
        }
        if (arg === "--allowMissingProject") {
            out.allowMissingProject = true;
            continue;
        }
        if (arg === "--allowMissingLlm") {
            out.allowMissingCandidate = true;
            continue;
        }
        if (arg === "--noAutoDiscoverLayers") {
            out.autoDiscoverLayers = false;
            continue;
        }
    }

    return out;
}

async function main(): Promise<void> {
    const options = parseArgs(process.argv.slice(2));
    const loaded = loadRuleSet({
        kernelRulePath: options.kernelRulePath,
        ruleCatalogPath: options.ruleCatalogPath,
        projectRulePath: options.projectRulePath,
        candidateRulePath: options.candidateRulePath,
        autoDiscoverLayers: options.autoDiscoverLayers,
        allowMissingProject: options.allowMissingProject,
        allowMissingCandidate: options.allowMissingCandidate,
    });

    const counts = summarizeRuleSet(loaded.ruleSet);
    const transferStats = summarizeTransferEndpoints(loaded.ruleSet.transfers || []);
    const sanitizerStats = summarizeSanitizerTargets(loaded.ruleSet.sanitizers || []);

    console.log("====== Rule Schema Validation ======");
    console.log(`kernel_rule=${loaded.kernelRulePath || "N/A"}`);
    console.log(`rule_catalog=${loaded.ruleCatalogPath || "N/A"}`);
    console.log(`project=${loaded.projectRulePath || "N/A"}`);
    console.log(`candidate_rule=${loaded.candidateRulePath || "N/A"}`);
    console.log(`applied_layers=${loaded.appliedLayerOrder.join(" -> ")}`);
    console.log(`schemaVersion=${loaded.ruleSet.schemaVersion}`);
    console.log(`sources=${counts.sources}`);
    console.log(`sinks=${counts.sinks}`);
    console.log(`sanitizers=${counts.sanitizers}`);
    console.log(`transfers=${counts.transfers}`);
    console.log(`warnings=${loaded.warnings.length}`);
    if (loaded.warnings.length > 0) {
        for (const w of loaded.warnings) {
            console.log(`  - ${w}`);
        }
    }

    console.log("transfer_endpoints=");
    for (const key of Object.keys(transferStats).sort()) {
        console.log(`  ${key}: ${transferStats[key]}`);
    }
    console.log("sanitizer_targets=");
    for (const key of Object.keys(sanitizerStats).sort()) {
        console.log(`  ${key}: ${sanitizerStats[key]}`);
    }

    const sourceKinds = (loaded.ruleSet.sources || [])
        .map(r => r.sourceKind || "N/A")
        .filter((v, idx, arr) => arr.indexOf(v) === idx)
        .sort();
    const sinkCategories = (loaded.ruleSet.sinks || [])
        .map(r => r.category || "N/A")
        .filter((v, idx, arr) => arr.indexOf(v) === idx)
        .sort();
    console.log(`source_kinds=${sourceKinds.join(",")}`);
    console.log(`sink_categories=${sinkCategories.join(",")}`);

    if (loaded.kernelRulePath) {
        console.log(`resolved_kernel_rule=${path.resolve(loaded.kernelRulePath)}`);
    }
    console.log("layer_status=");
    for (const s of loaded.layerStatus) {
        console.log(`  ${s.name}: exists=${s.exists} applied=${s.applied} source=${s.source} path=${s.path}`);
    }
}

main().catch(err => {
    console.error(err);
    process.exitCode = 1;
});
