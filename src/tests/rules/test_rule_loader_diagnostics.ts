import * as fs from "fs";
import * as path from "path";
import { RuleLoadError, loadRuleSet } from "../../core/rules/RuleLoader";
import { formatDiagnosticsText, writeDiagnosticsArtifacts } from "../../cli/diagnosticsFormat";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

function main(): void {
    const fixtureDir = path.resolve("tmp/test_runs/diagnostics/rule_loader_diagnostics/latest");
    fs.rmSync(fixtureDir, { recursive: true, force: true });
    fs.mkdirSync(fixtureDir, { recursive: true });

    const brokenJsonPath = path.join(fixtureDir, "broken_json.rules.json");
    fs.writeFileSync(
        brokenJsonPath,
        "{\n  \"schemaVersion\": \"2.0\",\n  \"sources\": [\n",
        "utf-8",
    );
    let brokenJsonError: RuleLoadError | undefined;
    try {
        loadRuleSet({
            ruleCatalogPath: "src/rules",
            projectRulePath: brokenJsonPath,
        });
    } catch (error) {
        brokenJsonError = error as RuleLoadError;
    }
    assert(brokenJsonError instanceof RuleLoadError, "broken JSON should throw RuleLoadError");
    assert(brokenJsonError.issues[0].kind === "json_parse", "broken JSON should be classified as json_parse");
    assert(brokenJsonError.issues[0].path === path.resolve(brokenJsonPath), "broken JSON issue should carry file path");
    assert(brokenJsonError.issues[0].line === 4, "broken JSON should report syntax line");
    assert(typeof brokenJsonError.issues[0].column === "number" && brokenJsonError.issues[0].column > 0, "broken JSON should report syntax column");
    assert(
        brokenJsonError.issues[0].userMessage.includes(":4:"),
        "broken JSON user message should include line information",
    );
    const diagnosticsText = formatDiagnosticsText({
        ruleLoadIssues: brokenJsonError.issues,
        moduleLoadIssues: [],
        moduleRuntimeFailures: [],
        enginePluginLoadIssues: [],
        enginePluginRuntimeFailures: [],
        systemFailures: [],
    });
    assert(diagnosticsText.includes("ArkTaint diagnostics"), "text diagnostics should include header");
    assert(diagnosticsText.includes("RULE_JSON_PARSE"), "text diagnostics should include a stable error code");
    assert(diagnosticsText.includes(path.resolve(brokenJsonPath)), "text diagnostics should include source location");
    assert(diagnosticsText.includes("Unexpected end of JSON input"), "text diagnostics should include the parse message");
    assert(diagnosticsText.includes("~~~~"), "text diagnostics should include a squiggle marker");

    const brokenRulePath = path.join(fixtureDir, "broken_rule.rules.json");
    fs.writeFileSync(
        brokenRulePath,
        JSON.stringify({
            schemaVersion: "2.0",
            sources: [
                {
                    id: "source.bad",
                    sourceKind: "callback_param",
                    match: {
                        kind: "method_name_equals",
                        value: "foo",
                    },
                    target: "result",
                },
            ],
            sinks: [],
            sanitizers: [],
            transfers: [],
        }, null, 2),
        "utf-8",
    );
    let brokenRuleError: RuleLoadError | undefined;
    try {
        loadRuleSet({
            ruleCatalogPath: "src/rules",
            projectRulePath: brokenRulePath,
        });
    } catch (error) {
        brokenRuleError = error as RuleLoadError;
    }
    assert(brokenRuleError instanceof RuleLoadError, "invalid rule content should throw RuleLoadError");
    assert(brokenRuleError.issues[0].kind === "schema_assert", "invalid rule content should be classified as schema_assert");
    assert(
        brokenRuleError.issues.some(issue => issue.fieldPath === "sources[0].callback_param"),
        "invalid rule content should expose field path",
    );
    assert(
        brokenRuleError.issues.some(issue => issue.line === 4 && typeof issue.column === "number" && issue.column > 0),
        "invalid rule content should locate the closest JSON object position",
    );
    assert(
        brokenRuleError.issues[0].userMessage.includes(path.resolve(brokenRulePath)),
        "user-facing rule load message should include file path",
    );
    const brokenRuleDiagnosticsText = formatDiagnosticsText({
        ruleLoadIssues: brokenRuleError.issues,
        moduleLoadIssues: [],
        moduleRuntimeFailures: [],
        enginePluginLoadIssues: [],
        enginePluginRuntimeFailures: [],
        systemFailures: [],
    });
    assert(
        brokenRuleDiagnosticsText.includes("RULE_SCHEMA_INVALID"),
        "schema validation diagnostics should include a stable error code",
    );
    assert(
        brokenRuleDiagnosticsText.includes("sources[0].callback_param"),
        "schema validation diagnostics should include the offending field path",
    );

    const genericRuntimeDiagnosticsText = formatDiagnosticsText({
        ruleLoadIssues: [],
        moduleLoadIssues: [],
        moduleRuntimeFailures: [],
        enginePluginLoadIssues: [],
        enginePluginRuntimeFailures: [
            {
                pluginName: "fixture.unknown",
                phase: "onStart",
                message: "totally-unclassified-problem",
                code: "PLUGIN_ON_START_THROW",
                advice: "Check the plugin callback near this location for thrown errors.",
                path: brokenRulePath,
                line: 3,
                column: 3,
                userMessage: "fixture.unknown failed",
            },
        ],
        systemFailures: [],
    });
    assert(
        genericRuntimeDiagnosticsText.includes("PLUGIN_ON_START_THROW"),
        "unclassified runtime diagnostics should still emit a stable fallback error code",
    );
    assert(
        genericRuntimeDiagnosticsText.includes("Check the plugin callback"),
        "unclassified runtime diagnostics should fall back to a generic readable suggestion",
    );

    const artifactDir = path.join(fixtureDir, "artifacts");
    const systemDiagnostics = {
        ruleLoadIssues: [],
        moduleLoadIssues: [],
        moduleRuntimeFailures: [],
        enginePluginLoadIssues: [],
        enginePluginRuntimeFailures: [],
        systemFailures: [
            {
                phase: "analyze",
                message: "top-level-failure",
                code: "SYSTEM_ANALYZE_THROW",
                summary: "Analyze mainline threw an unclassified error.",
                advice: "Check the analyze mainline near this location.",
                title: "Analyze mainline",
                path: brokenRulePath,
                line: 3,
                column: 3,
                userMessage: "top-level failure",
            },
        ],
    };
    const { jsonPath } = writeDiagnosticsArtifacts(artifactDir, systemDiagnostics);
    const normalizedJson = JSON.parse(fs.readFileSync(jsonPath, "utf-8")) as {
        schemaVersion?: string;
        itemCount?: number;
        items?: Array<{ category?: string; code?: string; summary?: string }>;
        rawDiagnostics?: { systemFailures?: Array<{ code?: string }> };
    };
    assert(normalizedJson.schemaVersion === "1.0", "diagnostics.json should expose schemaVersion");
    assert(normalizedJson.itemCount === 1, "diagnostics.json should store normalized item count");
    assert(normalizedJson.items?.[0]?.category === "System", "diagnostics.json should expose normalized system diagnostics");
    assert(normalizedJson.items?.[0]?.code === "SYSTEM_ANALYZE_THROW", "diagnostics.json should carry normalized codes");
    assert(
        normalizedJson.rawDiagnostics?.systemFailures?.[0]?.code === "SYSTEM_ANALYZE_THROW",
        "diagnostics.json should still preserve raw diagnostics",
    );

    const ruleDir = path.join(fixtureDir, "soft_warning_rules");
    fs.mkdirSync(ruleDir, { recursive: true });
    const emptyRuleSet = JSON.stringify({
        schemaVersion: "2.0",
        sources: [],
        sinks: [],
        sanitizers: [],
        transfers: [],
    }, null, 2);
    fs.mkdirSync(path.join(ruleDir, "sources", "kernel"), { recursive: true });
    fs.mkdirSync(path.join(ruleDir, "sinks", "kernel"), { recursive: true });
    fs.mkdirSync(path.join(ruleDir, "sanitizers", "kernel"), { recursive: true });
    fs.mkdirSync(path.join(ruleDir, "transfers", "kernel"), { recursive: true });
    fs.writeFileSync(path.join(ruleDir, "sources", "kernel", "alpha.rules.json"), emptyRuleSet, "utf-8");
    fs.writeFileSync(path.join(ruleDir, "sinks", "kernel", "beta.rules.json"), emptyRuleSet, "utf-8");
    fs.writeFileSync(path.join(ruleDir, "sanitizers", "kernel", "gamma.rules.json"), emptyRuleSet, "utf-8");
    fs.writeFileSync(path.join(ruleDir, "transfers", "kernel", "delta.rules.json"), emptyRuleSet, "utf-8");
    fs.writeFileSync(path.join(ruleDir, "junk.rules.json"), emptyRuleSet, "utf-8");
    fs.writeFileSync(path.join(ruleDir, "noise.bin"), "not-a-rule", "utf-8");
    const warnedRules = loadRuleSet({
        autoDiscoverLayers: false,
        ruleCatalogPath: ruleDir,
    });
    assert(
        warnedRules.warnings.some(item => item.includes("junk.rules.json")),
        "stray rule-like files should trigger a soft warning",
    );
    assert(
        warnedRules.warnings.some(item => item.includes("noise.bin")),
        "unexpected non-rule files in the rules directory should trigger a soft warning",
    );

    console.log("PASS test_rule_loader_diagnostics");
}

main();



