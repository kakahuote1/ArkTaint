import * as fs from "fs";
import * as http from "http";
import * as path from "path";
import { TaintPropagationEngine } from "../../core/orchestration/TaintPropagationEngine";
import { SinkRule, SourceRule } from "../../core/rules/RuleSchema";
import { createExternalEntryModelInvokerFromEnv } from "../../cli/externalEntryLlmClient";
import { buildTestScene } from "../helpers/TestSceneBuilder";

declare const process: any;

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

function buildRules(): {
    sourceRules: SourceRule[];
    sinkRules: SinkRule[];
} {
    return {
        sourceRules: [
            {
                id: "source.external_entry_llm.result",
                sourceKind: "call_return",
                target: "result",
                match: { kind: "method_name_equals", value: "Source" },
            },
        ],
        sinkRules: [
            {
                id: "sink.external_entry_llm.arg0",
                target: { endpoint: "arg0" },
                match: { kind: "method_name_equals", value: "Sink" },
            },
        ],
    };
}

async function runEngine(projectDir: string, options?: {
    modelInvoker?: ReturnType<typeof createExternalEntryModelInvokerFromEnv>;
    cachePath?: string;
    inspectMethodName?: string;
}): Promise<{
    seedCount: number;
    flowCount: number;
    report: ReturnType<TaintPropagationEngine["getExternalEntryRecognitionReport"]>;
    inspectedMethodSignature?: string;
}> {
    const scene = buildTestScene(projectDir);
    const engine = new TaintPropagationEngine(scene, 1, options?.modelInvoker
        ? {
            externalEntryRecognition: {
                enabled: true,
                model: "mock-http-entry-model",
                batchSize: 8,
                maxCandidates: 32,
                minConfidence: 0.9,
                enableCache: Boolean(options.cachePath),
                cachePath: options.cachePath,
                enableExternalEntryFacts: true,
                modelInvoker: options.modelInvoker,
            },
        }
        : undefined,
    );
    engine.verbose = false;
    await engine.buildPAG({ entryModel: "arkMain" });
    const reachable = engine.computeReachableMethodSignatures();
    engine.setActiveReachableMethodSignatures(reachable);

    const { sourceRules, sinkRules } = buildRules();
    const seedInfo = engine.propagateWithSourceRules(sourceRules);
    const flows = engine.detectSinksByRules(sinkRules);
    const inspectedMethodSignature = options?.inspectMethodName
        ? scene.getMethods().find(item =>
            item.getName?.() === options.inspectMethodName
            && item.getSignature?.()?.toString?.().includes("LandingShell"),
        )?.getSignature?.()?.toString?.()
        : undefined;

    return {
        seedCount: seedInfo.seedCount,
        flowCount: flows.length,
        report: engine.getExternalEntryRecognitionReport(),
        inspectedMethodSignature,
    };
}

async function createMockLlmServer(targetMethodSignature: string): Promise<{
    baseUrl: string;
    getRequestCount: () => number;
    close: () => Promise<void>;
}> {
    let requestCount = 0;

    const server = http.createServer((req, res) => {
        if (req.method !== "POST" || req.url !== "/responses") {
            res.statusCode = 404;
            res.end("not found");
            return;
        }

        requestCount++;
        let body = "";
        req.on("data", chunk => {
            body += chunk.toString();
        });
        req.on("end", () => {
            assert(body.includes("ArkTS framework entry recognition"), "mock LLM should receive the classifier prompt");
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({
                output_text: JSON.stringify([
                    {
                        methodSignature: targetMethodSignature,
                        isEntry: true,
                        confidence: 0.97,
                        phase: "bootstrap",
                        kind: "page_lifecycle",
                        reason: "framework-managed page callback inferred by hosted LLM",
                        evidenceTags: ["component_owner", "launch_path"],
                    },
                ]),
            }));
        });
    });

    await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => resolve());
    });

    const address = server.address();
    assert(address && typeof address === "object", "failed to resolve mock LLM server address");

    return {
        baseUrl: `http://127.0.0.1:${address.port}`,
        getRequestCount: () => requestCount,
        close: () => new Promise<void>((resolve, reject) => {
            server.close(error => error ? reject(error) : resolve());
        }),
    };
}

async function main(): Promise<void> {
    const projectDir = path.resolve("tests/demo/external_entry_llm");
    const outputRoot = path.resolve("tmp/test_runs/entry_model/external_entry_llm_pipeline/latest");
    const cachePath = path.resolve(outputRoot, "external_entry_cache.json");
    fs.rmSync(outputRoot, { recursive: true, force: true });
    fs.mkdirSync(outputRoot, { recursive: true });

    const baseline = await runEngine(projectDir, {
        inspectMethodName: "hydrateLaunchData",
    });
    const targetMethodSignature = baseline.inspectedMethodSignature;
    assert(targetMethodSignature, "failed to inspect hydrateLaunchData signature from baseline scene");
    assert(baseline.seedCount === 0, `baseline should not seed hidden external entry, got ${baseline.seedCount}`);
    assert(baseline.flowCount === 0, `baseline should not detect flow without external entry recognition, got ${baseline.flowCount}`);

    const server = await createMockLlmServer(targetMethodSignature);
    const previousEnv = {
        apiKey: process.env.ARKTAINT_EXTERNAL_ENTRY_API_KEY,
        baseUrl: process.env.ARKTAINT_EXTERNAL_ENTRY_BASE_URL,
        model: process.env.ARKTAINT_EXTERNAL_ENTRY_MODEL,
        apiStyle: process.env.ARKTAINT_EXTERNAL_ENTRY_API_STYLE,
    };

    try {
        process.env.ARKTAINT_EXTERNAL_ENTRY_API_KEY = "local-test-key";
        process.env.ARKTAINT_EXTERNAL_ENTRY_BASE_URL = server.baseUrl;
        process.env.ARKTAINT_EXTERNAL_ENTRY_MODEL = "mock-http-entry-model";
        process.env.ARKTAINT_EXTERNAL_ENTRY_API_STYLE = "responses";

        const invoker = createExternalEntryModelInvokerFromEnv({
            enabled: true,
        });
        assert(invoker, "expected external-entry LLM invoker from env");

        const llmRun = await runEngine(projectDir, {
            modelInvoker: invoker,
            cachePath,
        });
        assert(llmRun.seedCount > 0, `LLM-enabled run should seed source rules, got ${llmRun.seedCount}`);
        assert(llmRun.flowCount > 0, `LLM-enabled run should detect sink flow, got ${llmRun.flowCount}`);
        assert(llmRun.report?.candidateCount && llmRun.report.candidateCount > 0, "expected external-entry candidates");
        assert(llmRun.report?.recognitionCount && llmRun.report.recognitionCount > 0, "expected recognized external entry");
        assert(
            llmRun.report?.recognizedEntries.some(item => item.methodSignature === targetMethodSignature),
            "recognized entry list should include hydrateLaunchData",
        );

        const requestsAfterFirstRun = server.getRequestCount();
        assert(requestsAfterFirstRun > 0, "mock LLM server should receive at least one request");

        const cachedRun = await runEngine(projectDir, {
            modelInvoker: invoker,
            cachePath,
        });
        assert(cachedRun.seedCount > 0, `cached run should keep source seeds, got ${cachedRun.seedCount}`);
        assert(cachedRun.flowCount > 0, `cached run should keep detected flows, got ${cachedRun.flowCount}`);
        assert(
            server.getRequestCount() === requestsAfterFirstRun,
            "cached run should reuse persisted recognitions without extra HTTP requests",
        );

        console.log("====== External Entry LLM Pipeline ======");
        console.log(`baseline_seed_count=${baseline.seedCount}`);
        console.log(`baseline_flow_count=${baseline.flowCount}`);
        console.log(`llm_seed_count=${llmRun.seedCount}`);
        console.log(`llm_flow_count=${llmRun.flowCount}`);
        console.log(`llm_candidate_count=${llmRun.report?.candidateCount || 0}`);
        console.log(`llm_recognition_count=${llmRun.report?.recognitionCount || 0}`);
        console.log(`llm_promoted_method_count=${llmRun.report?.promotedMethodCount || 0}`);
        console.log(`llm_injected_fact_count=${llmRun.report?.injectedFactCount || 0}`);
        console.log(`http_request_count=${server.getRequestCount()}`);
        console.log(`cache_path=${cachePath}`);
        console.log("PASS test_entry_model_external_entry_llm_pipeline");
    } finally {
        process.env.ARKTAINT_EXTERNAL_ENTRY_API_KEY = previousEnv.apiKey;
        process.env.ARKTAINT_EXTERNAL_ENTRY_BASE_URL = previousEnv.baseUrl;
        process.env.ARKTAINT_EXTERNAL_ENTRY_MODEL = previousEnv.model;
        process.env.ARKTAINT_EXTERNAL_ENTRY_API_STYLE = previousEnv.apiStyle;
        await server.close();
    }
}

main().catch(error => {
    console.error("FAIL test_entry_model_external_entry_llm_pipeline");
    console.error(error);
    process.exit(1);
});
