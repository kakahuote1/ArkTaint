import * as fs from "fs";
import * as http from "http";
import * as path from "path";
import { getAnalyzeSummaryMarkdownPath, readAnalyzeSummary } from "../helpers/AnalyzeCliRunner";
import { parseArgs } from "../../cli/analyzeCliOptions";
import { runAnalyzeCliCommand } from "../../cli/analyze";
import { writeLlmConfigFile } from "../../cli/llmConfig";
import { resolvedAsset, ruleTransferAsset, vaultHandoffAsset, withSurfaceModulePath } from "../helpers/SemanticFlowMockAssetDecisions";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

function writeFixture(projectDir: string): void {
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(path.join(projectDir, "auto_model.ets"), [
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
        "    const restored = vault.get('token');",
        "    console.info(restored);",
        "  }",
        "}",
        "",
    ].join("\n"), "utf8");
}

async function createMockServer(): Promise<{
    baseUrl: string;
    close: () => Promise<void>;
}> {
    const server = http.createServer((req, res) => {
        if (req.method !== "POST" || req.url !== "/v1/chat/completions") {
            res.statusCode = 404;
            res.end("not found");
            return;
        }

        let body = "";
        req.on("data", chunk => {
            body += chunk.toString();
        });
        req.on("end", () => {
            const user = JSON.parse(body).messages?.find((item: any) => item.role === "user")?.content || "";
            const surface = String(user).match(/^surface:\s*(.+)$/m)?.[1]?.trim();
            const owner = String(user).match(/^owner:\s*(.+)$/m)?.[1]?.trim();
            const modulePath = modulePathFromPrompt(String(user));
            const sourceFile = String(user).match(/^sourceFile:\s*(.+)$/m)?.[1]?.trim();
            let decision: Record<string, unknown>;

            if (surface === "onCreate" && owner?.includes("DemoAbility")) {
                decision = {
                    status: "reject",
                    reason: "official ArkMain lifecycle is covered by built-in assets",
                };
            } else if (surface === "pass" && owner?.includes("Pipe")) {
                decision = resolvedAsset(withSurfaceModulePath(ruleTransferAsset("Pipe", "pass", 1), modulePath, sourceFile));
            } else if (surface === "put" && owner?.includes("Vault")) {
                decision = resolvedAsset(withSurfaceModulePath(vaultHandoffAsset("analyze_auto_model"), modulePath, sourceFile));
            } else {
                decision = {
                    status: "reject",
                    reason: "not relevant",
                };
            }

            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({
                choices: [
                    {
                        message: {
                            content: JSON.stringify(decision),
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
    assert(address && typeof address === "object", "failed to start mock server");

    return {
        baseUrl: `http://127.0.0.1:${address.port}`,
        close: () => new Promise<void>((resolve, reject) => {
            server.close(error => error ? reject(error) : resolve());
        }),
    };
}

interface AnalyzeReport {
    summary: {
        withSeeds: number;
        totalFlows: number;
        stageProfile: {
            incrementalCacheHitCount: number;
            incrementalCacheMissCount: number;
            incrementalCacheWriteCount: number;
        };
    };
}

function modulePathFromPrompt(prompt: string): string | undefined {
    const signature = prompt.match(/signature[:=]\s*([^\n]+)/)?.[1]?.trim();
    const modulePart = signature?.match(/^@?([^:]+):/)?.[1]?.trim();
    return modulePart || undefined;
}

async function main(): Promise<void> {
    const root = path.resolve("tmp/test_runs/analyze/auto_model/latest");
    const projectDir = path.join(root, "project");
    const llmConfigPath = path.join(root, "llm.json");
    fs.rmSync(root, { recursive: true, force: true });
    fs.mkdirSync(root, { recursive: true });
    writeFixture(projectDir);

    const server = await createMockServer();
    writeLlmConfigFile({
        activeProfile: "test",
        profiles: {
            test: {
                provider: "mock",
                baseUrl: server.baseUrl,
                model: "mock-analyze-auto",
                apiKey: "auto-model-test-key",
            },
        },
    }, llmConfigPath);

    try {
        await runAnalyzeCliCommand(parseArgs([
            "--repo", projectDir,
            "--sourceDir", ".",
            "--autoModel",
            "--llmConfig", llmConfigPath,
            "--llmProfile", "test",
            "--model", "mock-analyze-auto",
            "--no-incremental",
            "--outputDir", root,
        ]));

        getAnalyzeSummaryMarkdownPath(root);
        const report = readAnalyzeSummary<AnalyzeReport>(root);
        assert(report.summary.withSeeds > 0, `expected withSeeds > 0, got ${report.summary.withSeeds}`);
        assert(report.summary.totalFlows > 0, `expected totalFlows > 0, got ${report.summary.totalFlows}`);
        assert(report.summary.stageProfile.incrementalCacheHitCount === 0, `--no-incremental should disable final cache hits, got ${report.summary.stageProfile.incrementalCacheHitCount}`);
        assert(report.summary.stageProfile.incrementalCacheWriteCount === 0, `--no-incremental should disable final cache writes, got ${report.summary.stageProfile.incrementalCacheWriteCount}`);
        const phase1Report = JSON.parse(fs.readFileSync(path.join(root, "phase1", "summary", "summary.json"), "utf8")) as AnalyzeReport;
        assert(phase1Report.summary.stageProfile.incrementalCacheHitCount === 0, `--no-incremental should disable phase1 cache hits, got ${phase1Report.summary.stageProfile.incrementalCacheHitCount}`);
        assert(phase1Report.summary.stageProfile.incrementalCacheWriteCount === 0, `--no-incremental should disable phase1 cache writes, got ${phase1Report.summary.stageProfile.incrementalCacheWriteCount}`);
        assert(fs.existsSync(path.join(root, "phase1", "feedback", "rule_feedback", "no_candidate_callsites.json")), "missing phase1 rule feedback");
        assert(fs.existsSync(path.join(root, "assets.json")), "missing modeled assets artifact");

        console.log("PASS test_analyze_auto_model");
    } finally {
        await server.close();
    }
}

main().catch(error => {
    console.error("FAIL test_analyze_auto_model");
    console.error(error);
    process.exit(1);
});
