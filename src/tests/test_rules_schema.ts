import * as path from "path";
import { loadRuleSet, summarizeRuleSet, summarizeTransferEndpoints } from "../core/rules/RuleLoader";

interface CliOptions {
    defaultRulePath?: string;
    frameworkRulePath?: string;
    projectRulePath?: string;
    llmCandidateRulePath?: string;
    overrideRulePath?: string;
    autoDiscoverLayers?: boolean;
    allowMissingFramework?: boolean;
    allowMissingProject?: boolean;
    allowMissingLlmCandidate?: boolean;
    allowMissingOverride: boolean;
}

function parseArgs(argv: string[]): CliOptions {
    const out: CliOptions = {
        autoDiscoverLayers: true,
        allowMissingOverride: false,
    };

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--default" && i + 1 < argv.length) {
            out.defaultRulePath = argv[++i];
            continue;
        }
        if (arg.startsWith("--default=")) {
            out.defaultRulePath = arg.slice("--default=".length);
            continue;
        }
        if (arg === "--override" && i + 1 < argv.length) {
            out.overrideRulePath = argv[++i];
            continue;
        }
        if (arg.startsWith("--override=")) {
            out.overrideRulePath = arg.slice("--override=".length);
            continue;
        }
        if (arg === "--framework" && i + 1 < argv.length) {
            out.frameworkRulePath = argv[++i];
            continue;
        }
        if (arg.startsWith("--framework=")) {
            out.frameworkRulePath = arg.slice("--framework=".length);
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
        if (arg === "--llm" && i + 1 < argv.length) {
            out.llmCandidateRulePath = argv[++i];
            continue;
        }
        if (arg.startsWith("--llm=")) {
            out.llmCandidateRulePath = arg.slice("--llm=".length);
            continue;
        }
        if (arg === "--allowMissingOverride") {
            out.allowMissingOverride = true;
            continue;
        }
        if (arg === "--allowMissingFramework") {
            out.allowMissingFramework = true;
            continue;
        }
        if (arg === "--allowMissingProject") {
            out.allowMissingProject = true;
            continue;
        }
        if (arg === "--allowMissingLlm") {
            out.allowMissingLlmCandidate = true;
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
        defaultRulePath: options.defaultRulePath,
        frameworkRulePath: options.frameworkRulePath,
        projectRulePath: options.projectRulePath,
        llmCandidateRulePath: options.llmCandidateRulePath,
        overrideRulePath: options.overrideRulePath,
        autoDiscoverLayers: options.autoDiscoverLayers,
        allowMissingFramework: options.allowMissingFramework,
        allowMissingProject: options.allowMissingProject,
        allowMissingLlmCandidate: options.allowMissingLlmCandidate,
        allowMissingOverride: options.allowMissingOverride,
    });

    const counts = summarizeRuleSet(loaded.ruleSet);
    const transferStats = summarizeTransferEndpoints(loaded.ruleSet.transfers || []);

    console.log("====== Rule Schema Validation ======");
    console.log(`default=${loaded.defaultRulePath}`);
    console.log(`framework=${loaded.frameworkRulePath || "N/A"}`);
    console.log(`project=${loaded.projectRulePath || "N/A"}`);
    console.log(`llm_candidate=${loaded.llmCandidateRulePath || "N/A"}`);
    console.log(`override=${loaded.overrideRulePath || "N/A"}`);
    console.log(`applied_layers=${loaded.appliedLayerOrder.join(" -> ")}`);
    console.log(`schemaVersion=${loaded.ruleSet.schemaVersion}`);
    console.log(`sources=${counts.sources}`);
    console.log(`sinks=${counts.sinks}`);
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

    const sourceProfiles = (loaded.ruleSet.sources || [])
        .map(r => r.profile || "N/A")
        .filter((v, idx, arr) => arr.indexOf(v) === idx)
        .sort();
    const sinkProfiles = (loaded.ruleSet.sinks || [])
        .map(r => r.profile || "N/A")
        .filter((v, idx, arr) => arr.indexOf(v) === idx)
        .sort();
    console.log(`source_profiles=${sourceProfiles.join(",")}`);
    console.log(`sink_profiles=${sinkProfiles.join(",")}`);

    console.log(`resolved_default=${path.resolve(loaded.defaultRulePath)}`);
    console.log("layer_status=");
    for (const s of loaded.layerStatus) {
        console.log(`  ${s.name}: exists=${s.exists} applied=${s.applied} source=${s.source} path=${s.path}`);
    }
}

main().catch(err => {
    console.error(err);
    process.exitCode = 1;
});
