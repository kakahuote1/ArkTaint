import * as fs from "fs";
import * as http from "http";
import * as path from "path";
import { writeLlmConfigFile } from "../../cli/llmConfig";
import { runSemanticFlowCli } from "../../cli/semanticflow";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

function writeFixture(projectDir: string): void {
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(path.join(projectDir, "semanticflow_no_artifact.ets"), [
        "class UIAbility {",
        "  onCreate(want: string): void {}",
        "}",
        "",
        "class Pipe {",
        "  pass(value: string): string {",
        "    return value;",
        "  }",
        "}",
        "",
        "class Vault {",
        "  put(key: string, value: string): void {}",
        "  get(key: string): string {",
        "    return '';",
        "  }",
        "}",
        "",
        "class DemoAbility extends UIAbility {",
        "  onCreate(want: string): void {",
        "    const pipe = new Pipe();",
        "    const vault = new Vault();",
        "    const forwarded = pipe.pass(want);",
        "    vault.put('token', forwarded);",
        "    console.info(vault.get('token'));",
        "  }",
        "}",
        "",
    ].join("\n"), "utf8");
}

async function createNoArtifactMockServer(): Promise<{
    baseUrl: string;
    requestCount: () => number;
    close: () => Promise<void>;
}> {
    let requestCount = 0;
    const server = http.createServer((req, res) => {
        if (req.method !== "POST" || req.url !== "/v1/chat/completions") {
            res.statusCode = 404;
            res.end("not found");
            return;
        }

        req.on("data", () => undefined);
        req.on("end", () => {
            requestCount += 1;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({
                choices: [
                    {
                        message: {
                            content: JSON.stringify({
                                status: "done",
                                resolution: "no-transfer",
                                summary: {
                                    inputs: [],
                                    outputs: [],
                                    transfers: [],
                                    confidence: "medium",
                                },
                                rationale: ["candidate has no reusable semantic artifact"],
                            }),
                        },
                    },
                ],
            }));
        });
    });

    await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    assert(address && typeof address === "object", "failed to start mock semanticflow server");

    return {
        baseUrl: `http://127.0.0.1:${address.port}`,
        requestCount: () => requestCount,
        close: () => new Promise<void>((resolve, reject) => {
            server.close(error => error ? reject(error) : resolve());
        }),
    };
}

async function main(): Promise<void> {
    const root = path.resolve("tmp/test_runs/runtime/semanticflow_auto_no_artifact_reuse/latest");
    const projectDir = path.join(root, "project");
    const llmConfigPath = path.join(root, "llm.json");
    fs.rmSync(root, { recursive: true, force: true });
    fs.mkdirSync(root, { recursive: true });
    writeFixture(projectDir);

    const server = await createNoArtifactMockServer();
    writeLlmConfigFile({
        schemaVersion: 1,
        activeProfile: "test",
        profiles: {
            test: {
                provider: "mock",
                baseUrl: server.baseUrl,
                model: "mock-semanticflow-no-artifact",
                apiKey: "semanticflow-test-key",
            },
        },
    }, llmConfigPath);

    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: any[]) => {
        logs.push(args.map(String).join(" "));
        originalLog(...args);
    };

    try {
        await runSemanticFlowCli({
            repo: projectDir,
            sourceDirs: ["."],
            llmConfigPath,
            llmProfile: "test",
            outputDir: root,
            model: "mock-semanticflow-no-artifact",
            arkMainMaxCandidates: undefined,
            maxRounds: 1,
            concurrency: 2,
            contextRadius: 4,
            cfgNeighborRadius: 2,
            maxSliceItems: 48,
            examplesPerItem: 2,
            analyze: true,
            profile: "default",
            reportMode: "light",
            maxEntries: 12,
            k: 1,
            stopOnFirstFlow: false,
            maxFlowsPerEntry: undefined,
        });

        assert(server.requestCount() > 0, "expected at least one LLM request");
        assert(logs.some(line => line.includes("final_analyze skipped reason=no_modeled_artifacts reuse=bootstrap")), "expected no-artifact bootstrap reuse log");
        assert(!logs.some(line => line.includes("semanticflow_phase=final_analyze start")), "final analyze should not run when no artifacts were modeled");

        const rootSummary = JSON.parse(fs.readFileSync(path.join(root, "summary.json"), "utf8"));
        assert(rootSummary.itemCount > 0, `expected semanticflow items, got ${rootSummary.itemCount}`);
        assert((rootSummary.classifications["no-transfer"] || 0) === rootSummary.itemCount, "expected every item to resolve as no-transfer");
        assert(rootSummary.moduleCount === 0, `expected no module specs, got ${rootSummary.moduleCount}`);
        assert(rootSummary.sourceRuleCount === 0, `expected no source rules, got ${rootSummary.sourceRuleCount}`);
        assert(rootSummary.sinkRuleCount === 0, `expected no sink rules, got ${rootSummary.sinkRuleCount}`);
        assert(rootSummary.sanitizerRuleCount === 0, `expected no sanitizer rules, got ${rootSummary.sanitizerRuleCount}`);
        assert(rootSummary.transferRuleCount === 0, `expected no transfer rules, got ${rootSummary.transferRuleCount}`);
        assert(rootSummary.arkMainSpecCount === 0, `expected no arkMain specs, got ${rootSummary.arkMainSpecCount}`);

        const finalSummaryPath = path.join(root, "final", "summary", "summary.json");
        const finalDiagnosticsPath = path.join(root, "final", "diagnostics", "diagnostics.json");
        assert(fs.existsSync(finalSummaryPath), "expected reused final summary artifact");
        assert(fs.existsSync(finalDiagnosticsPath), "expected reused final diagnostics artifact");

        const analysis = JSON.parse(fs.readFileSync(path.join(root, "analysis.json"), "utf8"));
        assert(path.resolve(analysis.summaryJsonPath) === path.resolve(finalSummaryPath), `expected analysis summary to point at final summary, got ${analysis.summaryJsonPath}`);
        assert(path.resolve(analysis.diagnosticsJsonPath) === path.resolve(finalDiagnosticsPath), `expected analysis diagnostics to point at final diagnostics, got ${analysis.diagnosticsJsonPath}`);

        console.log("PASS testSemanticFlowAutoNoArtifactReuse");
    } finally {
        console.log = originalLog;
        await server.close();
    }
}

main().catch(error => {
    console.error("FAIL testSemanticFlowAutoNoArtifactReuse");
    console.error(error);
    process.exit(1);
});
