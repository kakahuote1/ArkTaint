import * as fs from "fs";
import * as http from "http";
import * as path from "path";
import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../../arkanalyzer/out/src/Config";
import { runSemanticFlowCli } from "../../cli/semanticflow";
import { writeLlmConfigFile } from "../../cli/llmConfig";
import { resolvedAsset, retargetAssetSurfacesToProjectModule, ruleSinkAsset, ruleSourceAsset, ruleTransferAsset, vaultHandoffAsset } from "../helpers/SemanticFlowMockAssetDecisions";

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
    const inputBoxSignature = findSignature(scene, "InputBox", "readSecret");
    const headerPipeSignature = findSignature(scene, "HeaderPipe", "cloneValue");
    const leakSignature = findSignature(scene, "Leak", "report");
    const vaultGetSignature = findSignature(scene, "Vault", "get");
    const inputBoxAsset = retargetAssetSurfacesToProjectModule(ruleSourceAsset("InputBox", "readSecret", 0), modulePathFromSignature(inputBoxSignature), "semanticflow_cli.ets");
    const headerPipeAsset = retargetAssetSurfacesToProjectModule(ruleTransferAsset("HeaderPipe", "cloneValue", 1), modulePathFromSignature(headerPipeSignature), "semanticflow_cli.ets");
    const leakAsset = retargetAssetSurfacesToProjectModule(ruleSinkAsset("Leak", "report", 1), modulePathFromSignature(leakSignature), "semanticflow_cli.ets");
    const vaultAsset = retargetAssetSurfacesToProjectModule(vaultHandoffAsset("semanticflow_cli"), modulePathFromSignature(vaultGetSignature), "semanticflow_cli.ets");
    const inputBoxSource = inputBoxAsset.surfaces[0].canonicalApiId;
    const headerPipeTransfer = headerPipeAsset.surfaces[0].canonicalApiId;
    const leakSink = leakAsset.surfaces[0].canonicalApiId;
    const vaultGet = vaultAsset.surfaces.find(surface =>
        surface.evidence?.arkanalyzer?.methodKey?.methodName === "get")?.canonicalApiId;
    const items = [
        {
            callee_signature: inputBoxSignature,
            method: "readSecret",
            invokeKind: "instance",
            argCount: 0,
            sourceFile: "semanticflow_cli.ets",
            canonicalApiId: inputBoxSource,
            topEntries: [canonicalSurfaceTopEntry(inputBoxAsset, "readSecret")],
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
            callee_signature: headerPipeSignature,
            method: "cloneValue",
            invokeKind: "instance",
            argCount: 1,
            sourceFile: "semanticflow_cli.ets",
            canonicalApiId: headerPipeTransfer,
            topEntries: [canonicalSurfaceTopEntry(headerPipeAsset, "cloneValue")],
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
            callee_signature: leakSignature,
            method: "report",
            invokeKind: "instance",
            argCount: 1,
            sourceFile: "semanticflow_cli.ets",
            canonicalApiId: leakSink,
            topEntries: [canonicalSurfaceTopEntry(leakAsset, "report")],
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
            callee_signature: vaultGetSignature,
            method: "get",
            invokeKind: "instance",
            argCount: 1,
            sourceFile: "semanticflow_cli.ets",
            canonicalApiId: vaultGet,
            topEntries: [
                canonicalSurfaceTopEntry(vaultAsset, "put"),
                canonicalSurfaceTopEntry(vaultAsset, "get"),
            ],
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

function canonicalSurfaceTopEntry(asset: any, methodName: string): string {
    const surface = asset.surfaces?.find((item: any) =>
        item.evidence?.arkanalyzer?.methodKey?.methodName === methodName);
    if (!surface) {
        throw new Error(`missing canonical surface for ${methodName}`);
    }
    return `canonicalApiSurface: ${JSON.stringify(surface)}`;
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

            if (surface?.includes("onCreate") && owner?.includes("DemoAbility")) {
                decision = {
                    status: "reject",
                    reason: "official ArkMain lifecycle is covered by built-in assets",
                };
            } else if (surface?.includes("readSecret")) {
                decision = resolvedAsset(retargetAssetSurfacesToProjectModule(ruleSourceAsset("InputBox", "readSecret", 0), modulePath, sourceFile));
            } else if (surface?.includes("cloneValue")) {
                decision = resolvedAsset(retargetAssetSurfacesToProjectModule(ruleTransferAsset("HeaderPipe", "cloneValue", 1), modulePath, sourceFile));
            } else if (surface?.includes("report")) {
                decision = resolvedAsset(retargetAssetSurfacesToProjectModule(ruleSinkAsset("Leak", "report", 1), modulePath, sourceFile));
            } else if (surface?.includes("get") && owner?.includes("Vault")) {
                decision = resolvedAsset(retargetAssetSurfacesToProjectModule(vaultHandoffAsset("semanticflow_cli"), modulePath, sourceFile));
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
    return signature ? modulePathFromSignature(signature) : undefined;
}

function modulePathFromSignature(signature: string): string | undefined {
    const modulePart = signature.match(/^@?([^:]+):/)?.[1]?.trim();
    return modulePart || undefined;
}

async function main(): Promise<void> {
    const root = path.resolve("tmp/test_runs/runtime/semanticflow_cli/latest");
    const projectDir = path.join(root, "project");
    const ruleInput = path.join(root, "rule_candidates.json");
    const singleRuleInput = path.join(root, "single_rule_candidate.json");
    const llmSessionCacheDir = path.join(root, "llm_session_cache");
    fs.rmSync(root, { recursive: true, force: true });
    fs.mkdirSync(root, { recursive: true });

    writeFixture(projectDir);
    const scene = buildScene(projectDir);
    buildRuleInput(scene, ruleInput);
    const allRuleInput = JSON.parse(fs.readFileSync(ruleInput, "utf8"));
    fs.writeFileSync(singleRuleInput, JSON.stringify({
        items: [
            {
                ...allRuleInput.items[0],
                returnType: "Promise<string>",
                candidateOrigin: "recall_api_surface",
                topEntries: [
                    ...(allRuleInput.items[0].topEntries || []),
                    "candidateKind=project-wrapper",
                    "coverageGapSource=semanticflow_cli_trace_fixture",
                    "coverageGapReason=coverage.role_endpoint_guard_gap",
                ],
            },
        ],
    }, null, 2), "utf8");

    const server = await createMockServer();
    const llmConfigPath = path.join(root, "llm.json");
    writeLlmConfigFile({
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
        const noArkMainRoot = path.join(root, "no_arkmain_gate");
        await runSemanticFlowCli({
            repo: projectDir,
            sourceDirs: ["."],
            llmConfigPath,
            llmProfile: "test",
            ruleInput: singleRuleInput,
            outputDir: noArkMainRoot,
            model: "mock-semanticflow-cli",
            arkMainMaxCandidates: 0,
            maxRounds: 2,
            concurrency: 1,
            contextRadius: 4,
            cfgNeighborRadius: 2,
            maxSliceItems: 48,
            examplesPerItem: 2,
            analyze: false,
            profile: "default",
            reportMode: "light",
            maxEntries: 12,
            k: 1,
            stopOnFirstFlow: false,
            maxFlowsPerEntry: undefined,
            maxLlmItems: 1,
            llmSessionCacheDir: path.join(noArkMainRoot, "llm_session_cache"),
            llmSessionCacheMode: "rw",
        });
        const noArkMainSummary = JSON.parse(fs.readFileSync(path.join(noArkMainRoot, "analysis.json"), "utf8"));
        assert(noArkMainSummary.itemCount === 2, `expected original plus returned-value focus item, got ${noArkMainSummary.itemCount}`);
        assert(noArkMainSummary.finalAnalyze === false, "standalone semanticflow gate should not run final analyze");
        assert((noArkMainSummary.planes.arkmain || 0) === 0, `expected zero ArkMain LLM items, got ${noArkMainSummary.planes.arkmain || 0}`);
        const noArkMainTrace = JSON.parse(fs.readFileSync(path.join(noArkMainRoot, "semanticflow_trace_graph", "full_trace_graph.json"), "utf8"));
        assert(
            noArkMainTrace.gates.some((gate: any) => gate.scope?.includes("rule_input_normalization")
                && gate.evidence?.returnedValueSiblingCreatedCount === 1),
            "standalone SemanticFlow CLI trace must record ruleInput normalization summary",
        );
        assert(
            noArkMainTrace.coverage.some((record: any) => record.kind === "semanticflow_candidate"
                && JSON.stringify(record.evidence || {}).includes("returned_value_sibling_created")
                && JSON.stringify(record.evidence || {}).includes("returned_value_surface")),
            "standalone SemanticFlow CLI trace coverage must expose returned-value sibling packaging",
        );
        assert(
            noArkMainTrace.coverage.some((record: any) => record.kind === "asset_promotion"
                && record.stage === "asset_promotion"
                && record.status === "emitted"
                && record.evidence?.toStatus === "schema-valid"),
            "standalone SemanticFlow CLI trace must record generated asset promotion to schema-valid",
        );
        assert(
            noArkMainTrace.coverage.some((record: any) => record.kind === "asset_lowering"
                && record.stage === "asset_lowering"
                && record.status === "emitted"
                && record.evidence?.sourceRuleCount === 1),
            "standalone SemanticFlow CLI trace must record evaluation lowering for generated source assets",
        );

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
            llmSessionCacheDir,
            llmSessionCacheMode: "rw",
        });

        const cacheStats = JSON.parse(fs.readFileSync(path.join(llmSessionCacheDir, "stats.json"), "utf8"));
        if (typeof cacheStats.llmCacheWriteCount !== "number" || cacheStats.llmCacheWriteCount <= 0) {
            throw new Error(`expected semanticflow session cache writes, got ${JSON.stringify(cacheStats)}`);
        }

        const summary = JSON.parse(fs.readFileSync(path.join(root, "summary.json"), "utf8"));
        const analysis = JSON.parse(fs.readFileSync(path.join(root, "analysis.json"), "utf8"));
        const finalSummary = JSON.parse(fs.readFileSync(analysis.summaryJsonPath, "utf8"));
        const assets = JSON.parse(fs.readFileSync(path.join(root, "assets.json"), "utf8"));

        assert(summary.resolutions.resolved === 4, `expected four resolved semanticflow items, got ${summary.resolutions.resolved || 0}`);
        assert(summary.planes.rule === 3, `expected three rule assets, got ${summary.planes.rule || 0}`);
        assert(summary.planes.module === 1, `expected one module asset, got ${summary.planes.module || 0}`);
        assert((summary.planes.arkmain || 0) === 0, `expected no semanticflow arkmain asset, got ${summary.planes.arkmain || 0}`);
        assert((summary.arkMainKernelCoveredCount || 0) === 0, `expected no kernel-covered arkmain candidate, got ${summary.arkMainKernelCoveredCount || 0}`);
        assert(summary.moduleCount === 1, `expected moduleCount=1, got ${summary.moduleCount}`);
        assert(Array.isArray(assets) && assets.length === 4, `expected four modeled assets, got ${Array.isArray(assets) ? assets.length : "non-array"}`);
        assert(assets.filter((asset: any) => asset.plane === "rule").length === 3, "expected three rule asset documents");
        assert(assets.filter((asset: any) => asset.plane === "module").length === 1, "expected one module asset document");
        assert(finalSummary.summary && typeof finalSummary.summary.totalEntries === "number", "expected final analyze summary artifact");

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
