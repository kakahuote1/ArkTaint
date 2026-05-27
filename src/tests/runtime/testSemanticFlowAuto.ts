import * as fs from "fs";
import * as http from "http";
import * as path from "path";
import { runSemanticFlowCli } from "../../cli/semanticflow";
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
    fs.writeFileSync(path.join(projectDir, "semanticflow_auto.ets"), [
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
                decision = resolvedAsset(withSurfaceModulePath(vaultHandoffAsset("semanticflow_auto"), modulePath, sourceFile));
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
    assert(address && typeof address === "object", "failed to start mock semanticflow server");

    return {
        baseUrl: `http://127.0.0.1:${address.port}`,
        close: () => new Promise<void>((resolve, reject) => {
            server.close(error => error ? reject(error) : resolve());
        }),
    };
}

function modulePathFromPrompt(prompt: string): string | undefined {
    const signature = prompt.match(/signature[:=]\s*([^\n]+)/)?.[1]?.trim();
    const modulePart = signature?.match(/^@?([^:]+):/)?.[1]?.trim();
    return modulePart || undefined;
}

async function main(): Promise<void> {
    const root = path.resolve("tmp/test_runs/runtime/semanticflow_auto/latest");
    const projectDir = path.join(root, "project");
    const llmConfigPath = path.join(root, "llm.json");
    const llmSessionCacheDir = path.join(root, "llm_session_cache");
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
                model: "mock-semanticflow-auto",
                apiKey: "semanticflow-test-key",
            },
        },
    }, llmConfigPath);

    try {
        await runSemanticFlowCli({
            repo: projectDir,
            sourceDirs: ["."],
            llmConfigPath,
            llmProfile: "test",
            outputDir: root,
            model: "mock-semanticflow-auto",
            arkMainMaxCandidates: undefined,
            maxRounds: 2,
            concurrency: 4,
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
            llmSessionCacheDir,
            llmSessionCacheMode: "rw",
        });

        const cacheStats = JSON.parse(fs.readFileSync(path.join(llmSessionCacheDir, "stats.json"), "utf8"));
        if (typeof cacheStats.llmCacheWriteCount !== "number" || cacheStats.llmCacheWriteCount <= 0) {
            throw new Error(`expected semanticflow session cache writes, got ${JSON.stringify(cacheStats)}`);
        }

        const runManifest = JSON.parse(fs.readFileSync(path.join(root, "run.json"), "utf8"));
        const rootSummary = JSON.parse(fs.readFileSync(path.join(root, "summary.json"), "utf8"));
        const assets = JSON.parse(fs.readFileSync(path.join(root, "assets.json"), "utf8"));
        const analysis = JSON.parse(fs.readFileSync(path.join(root, "analysis.json"), "utf8"));
        const finalSummary = JSON.parse(fs.readFileSync(analysis.summaryJsonPath, "utf8"));

        assert(fs.existsSync(path.join(root, runManifest.paths.phase1RuleInput)), "phase1 no_candidate artifact missing");
        assert((rootSummary.planes.arkmain || 0) === 0, `expected no semanticflow arkmain item, got ${rootSummary.planes.arkmain || 0}`);
        assert(rootSummary.assetCountByPlane.rule === 1, `expected one deduped rule asset, got ${rootSummary.assetCountByPlane.rule || 0}`);
        assert(rootSummary.assetCountByPlane.module === 1, `expected one deduped module asset, got ${rootSummary.assetCountByPlane.module || 0}`);
        assert(rootSummary.arkMainKernelCoveredCount === 1, `expected one kernel-covered arkmain candidate, got ${rootSummary.arkMainKernelCoveredCount || 0}`);
        assert((assets.assets || assets).length === 2, `expected two generated assets, got ${(assets.assets || assets).length}`);
        assert(finalSummary.summary.totalFlows > 0, `expected final analyze flow, got ${finalSummary.summary.totalFlows}`);

        console.log("PASS testSemanticFlowAuto");
    } finally {
        await server.close();
    }
}

main().catch(error => {
    console.error("FAIL testSemanticFlowAuto");
    console.error(error);
    process.exit(1);
});
