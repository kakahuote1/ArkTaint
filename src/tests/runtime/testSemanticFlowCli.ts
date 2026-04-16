import * as fs from "fs";
import * as http from "http";
import * as path from "path";
import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../../arkanalyzer/out/src/Config";
import { runSemanticFlowCli } from "../../cli/semanticflow";
import { writeLlmConfigFile } from "../../cli/llmConfig";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

function buildScene(projectDir: string): Scene {
    const config = new SceneConfig();
    config.buildFromProjectDir(projectDir);
    const scene = new Scene();
    scene.buildSceneFromProjectDir(config);
    scene.inferTypes();
    return scene;
}

function writeFixture(projectDir: string): void {
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(path.join(projectDir, "taintMockAbility.ts"), [
        "export class UIAbility {",
        "  onCreate(want: string): void {}",
        "}",
        "",
    ].join("\n"), "utf8");
    fs.writeFileSync(path.join(projectDir, "semanticflow_cli.ets"), [
        "import { UIAbility } from './taintMockAbility';",
        "",
        "export class InputBox {",
        "  readSecret(): string {",
        "    return 'secret';",
        "  }",
        "}",
        "",
        "export class HeaderPipe {",
        "  cloneValue(value: string): string {",
        "    return value;",
        "  }",
        "}",
        "",
        "export class Leak {",
        "  report(value: string): void {}",
        "}",
        "",
        "export class Vault {",
        "  put(key: string, value: string): void {}",
        "  get(key: string): string {",
        "    return '';",
        "  }",
        "}",
        "",
        "export class DemoAbility extends UIAbility {",
        "  onCreate(want: string): void {",
        "    const box = new InputBox();",
        "    const pipe = new HeaderPipe();",
        "    const leak = new Leak();",
        "    const raw = box.readSecret();",
        "    const forwarded = pipe.cloneValue(raw);",
        "    leak.report(forwarded);",
        "  }",
        "}",
        "",
    ].join("\n"), "utf8");
}

function findSignature(scene: Scene, className: string, methodName: string): string {
    for (const method of scene.getMethods()) {
        if (method.getName?.() !== methodName) {
            continue;
        }
        const declaringClass = method.getDeclaringArkClass?.();
        if (declaringClass?.getName?.() === className) {
            const signature = method.getSignature?.()?.toString?.();
            if (signature) {
                return signature;
            }
        }
    }
    throw new Error(`missing signature for ${className}.${methodName}`);
}

function buildRuleInput(scene: Scene, outputPath: string): void {
    const items = [
        {
            callee_signature: findSignature(scene, "InputBox", "readSecret"),
            method: "readSecret",
            invokeKind: "instance",
            argCount: 0,
            sourceFile: "semanticflow_cli.ets",
            contextSlices: [
                {
                    callerFile: "semanticflow_cli.ets",
                    callerMethod: "onCreate",
                    invokeLine: 24,
                    invokeStmtText: "const raw = box.readSecret();",
                    windowLines: "24 | const raw = box.readSecret();\n25 | const forwarded = pipe.cloneValue(raw);\n26 | leak.report(forwarded);",
                    cfgNeighborStmts: [
                        "const raw = box.readSecret();",
                        "const forwarded = pipe.cloneValue(raw);",
                        "leak.report(forwarded);",
                    ],
                },
            ],
        },
        {
            callee_signature: findSignature(scene, "HeaderPipe", "cloneValue"),
            method: "cloneValue",
            invokeKind: "instance",
            argCount: 1,
            sourceFile: "semanticflow_cli.ets",
            contextSlices: [
                {
                    callerFile: "semanticflow_cli.ets",
                    callerMethod: "onCreate",
                    invokeLine: 25,
                    invokeStmtText: "const forwarded = pipe.cloneValue(raw);",
                    windowLines: "24 | const raw = box.readSecret();\n25 | const forwarded = pipe.cloneValue(raw);\n26 | leak.report(forwarded);",
                    cfgNeighborStmts: [
                        "const raw = box.readSecret();",
                        "const forwarded = pipe.cloneValue(raw);",
                        "leak.report(forwarded);",
                    ],
                },
            ],
        },
        {
            callee_signature: findSignature(scene, "Leak", "report"),
            method: "report",
            invokeKind: "instance",
            argCount: 1,
            sourceFile: "semanticflow_cli.ets",
            contextSlices: [
                {
                    callerFile: "semanticflow_cli.ets",
                    callerMethod: "onCreate",
                    invokeLine: 26,
                    invokeStmtText: "leak.report(forwarded);",
                    windowLines: "24 | const raw = box.readSecret();\n25 | const forwarded = pipe.cloneValue(raw);\n26 | leak.report(forwarded);",
                    cfgNeighborStmts: [
                        "const raw = box.readSecret();",
                        "const forwarded = pipe.cloneValue(raw);",
                        "leak.report(forwarded);",
                    ],
                },
            ],
        },
        {
            callee_signature: findSignature(scene, "Vault", "get"),
            method: "get",
            invokeKind: "instance",
            argCount: 1,
            sourceFile: "semanticflow_cli.ets",
            contextSlices: [
                {
                    callerFile: "semanticflow_cli.ets",
                    callerMethod: "storageUse",
                    invokeLine: 30,
                    invokeStmtText: "vault.get(key)",
                    windowLines: "29 | vault.put(key, value)\n30 | vault.get(key)",
                    cfgNeighborStmts: [
                        "vault.put(key, value)",
                        "vault.get(key)",
                    ],
                },
            ],
        },
    ];
    fs.writeFileSync(outputPath, JSON.stringify({ items }, null, 2), "utf8");
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
                                reason: "framework lifecycle callback",
                                entryFamily: "semanticflow",
                                entryShape: "owner-slot",
                            },
                        },
                    },
                };
            } else if (surface === "readSecret") {
                decision = {
                    status: "done",
                    classification: "rule",
                    resolution: "resolved",
                    summary: {
                        inputs: [],
                        outputs: [{ slot: "result" }],
                        transfers: [],
                        confidence: "high",
                        ruleKind: "source",
                        sourceKind: "call_return",
                    },
                };
            } else if (surface === "cloneValue") {
                decision = {
                    status: "done",
                    classification: "rule",
                    resolution: "resolved",
                    summary: {
                        inputs: [{ slot: "arg", index: 0 }],
                        outputs: [{ slot: "result" }],
                        transfers: [
                            {
                                from: { slot: "arg", index: 0 },
                                to: { slot: "result" },
                                relation: "direct",
                            },
                        ],
                        confidence: "high",
                        ruleKind: "transfer",
                    },
                };
            } else if (surface === "report") {
                decision = {
                    status: "done",
                    classification: "rule",
                    resolution: "resolved",
                    summary: {
                        inputs: [{ slot: "arg", index: 0 }],
                        outputs: [],
                        transfers: [],
                        confidence: "high",
                        ruleKind: "sink",
                    },
                };
            } else if (surface === "get" && owner?.includes("Vault")) {
                decision = {
                    status: "done",
                    classification: "module",
                    resolution: "resolved",
                    summary: {
                        inputs: [],
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

async function main(): Promise<void> {
    const root = path.resolve("tmp/test_runs/runtime/semanticflow_cli/latest");
    const projectDir = path.join(root, "project");
    const ruleInput = path.join(root, "rule_candidates.json");
    fs.rmSync(root, { recursive: true, force: true });
    fs.mkdirSync(root, { recursive: true });

    writeFixture(projectDir);
    const scene = buildScene(projectDir);
    buildRuleInput(scene, ruleInput);

    const server = await createMockServer();
    const llmConfigPath = path.join(root, "llm.json");
    writeLlmConfigFile({
        schemaVersion: 1,
        activeProfile: "test",
        profiles: {
            test: {
                provider: "mock",
                baseUrl: server.baseUrl,
                model: "mock-semanticflow-cli",
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
            ruleInput,
            outputDir: root,
            model: "mock-semanticflow-cli",
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
        });

        const summary = JSON.parse(fs.readFileSync(path.join(root, "summary.json"), "utf8"));
        const runManifest = JSON.parse(fs.readFileSync(path.join(root, "run.json"), "utf8"));
        const summaryRun = JSON.parse(fs.readFileSync(path.join(root, "summary", "run.json"), "utf8"));
        const analysis = JSON.parse(fs.readFileSync(path.join(root, "analysis.json"), "utf8"));
        const finalSummary = JSON.parse(fs.readFileSync(analysis.summaryJsonPath, "utf8"));
        const rules = JSON.parse(fs.readFileSync(path.join(root, "rules.json"), "utf8"));
        const modules = JSON.parse(fs.readFileSync(path.join(root, "modules.json"), "utf8"));
        const arkmain = JSON.parse(fs.readFileSync(path.join(root, "arkmain.json"), "utf8"));

        assert(runManifest.llmSessionCache.cacheKind === "semanticflow_llm_session", "run manifest cache kind mismatch");
        assert(runManifest.llmSessionCache.schemaVersion === 1, "run manifest cache schema version mismatch");
        assert(fs.existsSync(path.join(root, runManifest.llmSessionCache.dir)), "run manifest cache dir missing");
        assert(fs.existsSync(path.join(root, runManifest.llmSessionCache.schemaPath)), "run manifest cache schema path missing");
        assert(fs.existsSync(path.join(root, runManifest.llmSessionCache.statsPath)), "run manifest cache stats path missing");
        assert(fs.existsSync(path.join(root, runManifest.llmSessionCache.decisionsDir)), "run manifest decisions dir missing");
        assert(fs.existsSync(path.join(root, runManifest.llmSessionCache.itemsDir)), "run manifest items dir missing");
        assert(fs.existsSync(path.join(root, runManifest.llmSessionCache.anchorsDir)), "run manifest anchors dir missing");
        assert((summary.classifications.arkmain || 0) === 0, `expected no semanticflow arkmain item, got ${summary.classifications.arkmain || 0}`);
        assert(summary.classifications.rule === 3, `expected three rule items, got ${summary.classifications.rule || 0}`);
        assert(summary.classifications.module === 1, `expected one module item, got ${summary.classifications.module || 0}`);
        assert(summary.arkMainKernelCoveredCount === 1, `expected one kernel-covered arkmain candidate, got ${summary.arkMainKernelCoveredCount || 0}`);
        assert(summary.moduleCount === 1, `expected moduleCount=1, got ${summary.moduleCount}`);
        assert(summary.arkMainSpecCount === 0, `expected arkMainSpecCount=0, got ${summary.arkMainSpecCount}`);
        assert(summary.llmCacheWriteCount > 0, `expected llmCacheWriteCount > 0, got ${summary.llmCacheWriteCount}`);
        assert(summary.itemCacheHitCount === 0, `expected itemCacheHitCount=0 on first run, got ${summary.itemCacheHitCount}`);

        assert((rules.sources || []).length === 1, `expected one source rule, got ${(rules.sources || []).length}`);
        assert((rules.sinks || []).length === 1, `expected one sink rule, got ${(rules.sinks || []).length}`);
        assert((rules.transfers || []).length === 1, `expected one transfer rule, got ${(rules.transfers || []).length}`);
        assert((modules.modules || []).length === 1, `expected one module spec, got ${(modules.modules || []).length}`);
        assert((arkmain.entries || []).length === 0, `expected no arkmain spec entry, got ${(arkmain.entries || []).length}`);
        assert(finalSummary.summary.withSeeds > 0, `expected final analyze to seed sources, got ${finalSummary.summary.withSeeds}`);
        assert(finalSummary.summary.totalFlows === 1, `expected final analyze to detect one flow, got ${finalSummary.summary.totalFlows}`);
        assert(summaryRun.llmSessionCache.cacheKind === "semanticflow_llm_session", "summary/run cache kind mismatch");
        assert(summaryRun.llmSessionCache.schemaVersion === 1, "summary/run cache schema version mismatch");
        assert(summaryRun.llmSessionCache.llmCacheWriteCount > 0, "summary/run.json should expose cache write stats");
        assert(summaryRun.llmSessionCache.itemCacheHitCount === 0, "summary/run.json should expose first-run item cache hits as zero");

        console.log("PASS testSemanticFlowCli");
    } finally {
        await server.close();
    }
}

main().catch(error => {
    console.error("FAIL testSemanticFlowCli");
    console.error(error);
    process.exit(1);
});
