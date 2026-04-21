import * as fs from "fs";
import * as http from "http";
import * as path from "path";
import { parseArgs } from "../../cli/analyzeCliOptions";
import { runAnalyzeCliCommand } from "../../cli/analyze";
import { writeLlmConfigFile } from "../../cli/llmConfig";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

function readSummary(outputDir: string): any {
    return JSON.parse(fs.readFileSync(path.join(outputDir, "summary", "summary.json"), "utf8"));
}

function readJson(absPath: string): any {
    return JSON.parse(fs.readFileSync(absPath, "utf8"));
}

function writeFixture(projectDir: string): void {
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(path.join(projectDir, "model_project.ets"), [
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

async function createMockServer(): Promise<{ baseUrl: string; close: () => Promise<void> }> {
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
            let decision: Record<string, unknown>;
            if (surface === "onCreate" && owner?.includes("DemoAbility")) {
                decision = {
                    status: "done",
                    classification: "arkmain",
                    resolution: "resolved",
                    summary: {
                        inputs: [{ slot: "arg", index: 0 }],
                        outputs: [],
                        transfers: [],
                        confidence: "high",
                        relations: {
                            entryPattern: {
                                phase: "bootstrap",
                                kind: "ability_lifecycle",
                                ownerKind: "ability_owner",
                                reason: "framework ability lifecycle entry",
                                entryFamily: "semanticflow",
                                entryShape: "owner-slot",
                            },
                        },
                    },
                };
            } else if (surface === "pass" && owner?.includes("Pipe")) {
                decision = {
                    status: "done",
                    classification: "rule",
                    resolution: "resolved",
                    summary: {
                        inputs: [{ slot: "arg", index: 0 }],
                        outputs: [{ slot: "result" }],
                        transfers: [{ from: { slot: "arg", index: 0 }, to: { slot: "result" }, relation: "direct" }],
                        confidence: "high",
                        ruleKind: "transfer",
                    },
                };
            } else if (surface === "put" && owner?.includes("Vault")) {
                decision = {
                    status: "done",
                    classification: "module",
                    resolution: "resolved",
                    summary: {
                        inputs: [{ slot: "arg", index: 1 }],
                        outputs: [],
                        transfers: [],
                        confidence: "high",
                        moduleSpec: {
                            id: "vault.storage",
                            semantics: [
                                {
                                    kind: "keyed_storage",
                                    storageClasses: ["Vault"],
                                    writeMethods: [{ methodName: "put", valueIndex: 1 }],
                                    readMethods: ["get"],
                                },
                            ],
                        },
                    },
                };
            } else {
                decision = {
                    status: "reject",
                    reason: "not relevant",
                };
            }
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({
                choices: [{ message: { content: JSON.stringify(decision) } }],
            }));
        });
    });

    await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    assert(address && typeof address === "object", "failed to start mock model project server");
    return {
        baseUrl: `http://127.0.0.1:${address.port}`,
        close: () => new Promise<void>((resolve, reject) => {
            server.close(error => error ? reject(error) : resolve());
        }),
    };
}

async function main(): Promise<void> {
    const root = path.resolve("tmp/test_runs/analyze/model_project_reuse/latest");
    const projectDir = path.join(root, "project");
    const llmConfigPath = path.join(root, "llm.json");
    const modelRoot = path.join(root, "assets");
    const autoOutputDir = path.join(root, "auto_model");
    const autoReuseOutputDir = path.join(root, "auto_model_reuse");
    const reuseOutputDir = path.join(root, "reuse");
    fs.rmSync(root, { recursive: true, force: true });
    fs.mkdirSync(root, { recursive: true });
    writeFixture(projectDir);

    const server = await createMockServer();
    writeLlmConfigFile({
        schemaVersion: 1,
        activeProfile: "test",
        profiles: {
            test: {
                provider: "mock",
                baseUrl: server.baseUrl,
                model: "mock-model-project",
                apiKey: "model-project-test-key",
            },
        },
    }, llmConfigPath);

    try {
        await runAnalyzeCliCommand(parseArgs([
            "--repo", projectDir,
            "--sourceDir", ".",
            "--autoModel",
            "--publish-model", "shared_demo",
            "--llmConfig", llmConfigPath,
            "--llmProfile", "test",
            "--model", "mock-model-project",
            "--model-root", modelRoot,
            "--no-incremental",
            "--outputDir", autoOutputDir,
        ]));

        assert(fs.existsSync(path.join(modelRoot, "project", "shared_demo", "rules", "semanticflow.rules.json")), "published rule set missing");
        assert(fs.existsSync(path.join(modelRoot, "project", "shared_demo", "modules", "semanticflow.modules.json")), "published module specs missing");
        assert(!fs.existsSync(path.join(modelRoot, "project", "shared_demo", "arkmain", "semanticflow.arkmain.json")), "built-in arkmain lifecycle should not publish project arkmain specs");

        await runAnalyzeCliCommand(parseArgs([
            "--repo", projectDir,
            "--sourceDir", ".",
            "--model-root", modelRoot,
            "--enable-model", "shared_demo",
            "--no-incremental",
            "--outputDir", reuseOutputDir,
        ]));

        const summary = readSummary(reuseOutputDir);
        assert(summary.summary.withSeeds > 0, `expected reuse analyze withSeeds > 0, got ${summary.summary.withSeeds}`);
        assert(summary.summary.totalFlows > 0, `expected reuse analyze totalFlows > 0, got ${summary.summary.totalFlows}`);

        await runAnalyzeCliCommand(parseArgs([
            "--repo", projectDir,
            "--sourceDir", ".",
            "--autoModel",
            "--llmConfig", llmConfigPath,
            "--llmProfile", "test",
            "--model", "mock-model-project",
            "--model-root", modelRoot,
            "--enable-model", "shared_demo",
            "--no-incremental",
            "--outputDir", autoReuseOutputDir,
        ]));

        const semanticflowSummary = readJson(path.join(autoReuseOutputDir, "summary.json"));
        assert(semanticflowSummary.itemCount === 1, `expected exactly one remaining unknown semanticflow item, got ${semanticflowSummary.itemCount}`);
        assert(semanticflowSummary.ruleKnownCoveredCount === 2, `expected enabled shared_demo pack to cover two known semanticflow rule candidates, got ${semanticflowSummary.ruleKnownCoveredCount}`);
        const semanticflowSession = readJson(path.join(autoReuseOutputDir, "session.json"));
        assert(semanticflowSession.items.length === 1, `expected one semanticflow session item after known filtering, got ${semanticflowSession.items.length}`);
        assert(semanticflowSession.items[0]?.anchor?.surface === "info", `expected remaining semanticflow item to be the unknown info callsite, got ${semanticflowSession.items[0]?.anchor?.surface}`);
        const autoReuseSummary = readSummary(autoReuseOutputDir);
        assert(autoReuseSummary.summary.withSeeds > 0, `expected auto-model reuse analyze withSeeds > 0, got ${autoReuseSummary.summary.withSeeds}`);
        assert(autoReuseSummary.summary.totalFlows > 0, `expected auto-model reuse analyze totalFlows > 0, got ${autoReuseSummary.summary.totalFlows}`);

        console.log("PASS test_analyze_model_project_reuse");
    } finally {
        await server.close();
    }
}

main().catch(error => {
    console.error("FAIL test_analyze_model_project_reuse");
    console.error(error);
    process.exit(1);
});
