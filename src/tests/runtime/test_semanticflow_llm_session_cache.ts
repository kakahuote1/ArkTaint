import * as fs from "fs";
import * as path from "path";
import { createSemanticFlowDraftId } from "../../core/semanticflow/SemanticFlowIncremental";
import { createSemanticFlowLlmDecider } from "../../core/semanticflow/SemanticFlowLlm";
import { runSemanticFlowPipeline } from "../../core/semanticflow/SemanticFlowPipeline";
import { SemanticFlowSessionCache } from "../../core/semanticflow/SemanticFlowSessionCache";
import type {
    SemanticFlowAnchor,
    SemanticFlowDecisionInput,
    SemanticFlowExpander,
    SemanticFlowSlicePackage,
} from "../../core/semanticflow/SemanticFlowTypes";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

function extractRound(user: string): number {
    const match = user.match(/^round:\s*(\d+)$/m);
    return match?.[1] ? Number(match[1]) : 0;
}

function resetDir(dirPath: string): void {
    fs.rmSync(dirPath, { recursive: true, force: true });
    fs.mkdirSync(dirPath, { recursive: true });
}

function buildAnchor(id: string, surface: string): SemanticFlowAnchor {
    return {
        id,
        owner: "CacheOwner",
        surface,
        methodSignature: `@project/cache.ts: CacheOwner.${surface}(string)`,
        filePath: "cache.ts",
        line: 1,
    };
}

function buildSlice(anchorId: string, round = 0, snippetCode = "cacheAnchor(value)"): SemanticFlowSlicePackage {
    return {
        anchorId,
        round,
        template: "call-return",
        observations: [`observation:${anchorId}:${round}`],
        snippets: [{ label: "anchor", code: snippetCode }],
        companions: [],
        notes: [],
    };
}

function buildDecisionInput(anchor: SemanticFlowAnchor, slice: SemanticFlowSlicePackage): SemanticFlowDecisionInput {
    return {
        anchor,
        draftId: createSemanticFlowDraftId(anchor),
        slice,
        round: slice.round,
        history: [],
    };
}

function readAllJsonText(rootDir: string): string[] {
    const out: string[] = [];
    const queue = [rootDir];
    while (queue.length > 0) {
        const current = queue.shift() as string;
        if (!fs.existsSync(current)) {
            continue;
        }
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            const fullPath = path.join(current, entry.name);
            if (entry.isDirectory()) {
                queue.push(fullPath);
                continue;
            }
            if (entry.isFile() && entry.name.endsWith(".json")) {
                out.push(fs.readFileSync(fullPath, "utf8"));
            }
        }
    }
    return out;
}

async function testSemanticFlowLlmSessionCacheHit(rootDir: string): Promise<void> {
    const cacheRoot = path.join(rootDir, "decision_hit");
    resetDir(cacheRoot);
    const anchor = buildAnchor("cache.hit.anchor", "copyValue");
    const slice = buildSlice(anchor.id);
    let modelCalls = 0;
    const cache = new SemanticFlowSessionCache({
        rootDir: cacheRoot,
        mode: "rw",
    });
    const decider = createSemanticFlowLlmDecider({
        model: "mock-cache-hit",
        sessionCache: cache,
        async modelInvoker() {
            modelCalls++;
            return JSON.stringify({
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
            });
        },
    });

    const first = await decider.decide(buildDecisionInput(anchor, slice));
    const second = await decider.decide(buildDecisionInput(anchor, slice));
    const stats = cache.getStats();

    assert(first.status === "done", "expected first cached decision to resolve");
    assert(second.status === "done", "expected second cached decision to resolve");
    assert(modelCalls === 1, `expected one LLM call after cache hit, got ${modelCalls}`);
    assert(stats.llmCacheHitCount === 1, `expected llmCacheHitCount=1, got ${stats.llmCacheHitCount}`);
    assert(stats.llmCacheMissCount === 1, `expected llmCacheMissCount=1, got ${stats.llmCacheMissCount}`);
    assert(stats.llmCacheWriteCount === 1, `expected llmCacheWriteCount=1, got ${stats.llmCacheWriteCount}`);
}

async function testSemanticFlowLlmSessionCacheInvalidateModel(rootDir: string): Promise<void> {
    const cacheRoot = path.join(rootDir, "invalidate_model");
    resetDir(cacheRoot);
    const anchor = buildAnchor("cache.invalidate.anchor", "copyValue");
    const slice = buildSlice(anchor.id);
    const cache = new SemanticFlowSessionCache({
        rootDir: cacheRoot,
        mode: "rw",
    });
    const counterA = { value: 0 };
    const counterB = { value: 0 };

    const makeDecider = (model: string, counter: { value: number }) => createSemanticFlowLlmDecider({
        model,
        sessionCache: cache,
        async modelInvoker() {
            counter.value++;
            return JSON.stringify({
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
            });
        },
    });

    await makeDecider("mock-cache-model-a", counterA).decide(buildDecisionInput(anchor, slice));
    await makeDecider("mock-cache-model-b", counterB).decide(buildDecisionInput(anchor, slice));
    const stats = cache.getStats();

    assert(counterA.value === 1, `expected model A to miss cache once, got ${counterA.value}`);
    assert(counterB.value === 1, `expected model B to miss cache once, got ${counterB.value}`);
    assert(stats.llmCacheMissCount === 2, `expected llmCacheMissCount=2, got ${stats.llmCacheMissCount}`);
    assert(stats.llmCacheWriteCount === 2, `expected llmCacheWriteCount=2, got ${stats.llmCacheWriteCount}`);
}

async function testSemanticFlowLlmSessionCacheNoRaw(rootDir: string): Promise<void> {
    const cacheRoot = path.join(rootDir, "no_raw");
    resetDir(cacheRoot);
    const snippetSentinel = "NO_RAW_SNIPPET_SENTINEL_2f63098d";
    const expandedSentinel = "NO_RAW_EXPANDED_SENTINEL_6ac4dc79";
    const anchor = buildAnchor("cache.no_raw.anchor", "emitValue");
    const initialSlice = buildSlice(anchor.id, 0, snippetSentinel);
    const cache = new SemanticFlowSessionCache({
        rootDir: cacheRoot,
        mode: "rw",
    });
    let modelCalls = 0;
    const decider = createSemanticFlowLlmDecider({
        model: "mock-cache-no-raw",
        sessionCache: cache,
        async modelInvoker(input) {
            modelCalls++;
            const round = extractRound(input.user);
            if (round === 0) {
                return [
                    "```json",
                    JSON.stringify({
                        status: "need-more-evidence",
                        draft: {
                            inputs: [{ slot: "arg", index: 0 }],
                            outputs: [{ slot: "result" }],
                            transfers: [],
                            confidence: "medium",
                            ruleKind: "transfer",
                        },
                        request: {
                            kind: "q_wrap",
                            focus: {
                                from: "arg0",
                                to: "ret",
                            },
                            scope: {
                                owner: "CacheOwner",
                                locality: "method",
                                surface: "emitValue",
                            },
                            budgetClass: "body_local",
                            why: ["need direct wrapper evidence"],
                            ask: "show the wrapper body",
                        },
                    }, null, 2),
                    "```",
                ].join("\n");
            }
            return [
                "```json",
                JSON.stringify({
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
                }, null, 2),
                "```",
            ].join("\n");
        },
    });
    const expander: SemanticFlowExpander = {
        async expand(input) {
            return {
                slice: {
                    ...input.slice,
                    round: input.round + 1,
                    observations: [...input.slice.observations, "wrapper body recovered"],
                    snippets: [...input.slice.snippets, { label: "expanded", code: expandedSentinel }],
                    notes: [...(input.slice.notes || []), input.deficit.ask],
                },
                delta: {
                    id: "delta.cache.no_raw",
                    newObservations: ["wrapper body recovered"],
                    newSnippets: [{ label: "expanded", code: expandedSentinel }],
                    newCompanions: [],
                    effective: true,
                },
            };
        },
    };

    const result = await runSemanticFlowPipeline(
        [{ anchor, initialSlice }],
        decider,
        expander,
        {
            maxRounds: 1,
            model: "mock-cache-no-raw",
            sessionCache: cache,
        },
    );

    assert(result.items[0]?.resolution === "resolved", "expected no-raw pipeline result to resolve");
    assert(modelCalls === 2, `expected two LLM calls for no-raw pipeline, got ${modelCalls}`);
    const texts = readAllJsonText(cacheRoot);
    assert(texts.length >= 5, `expected cache JSON artifacts to be written, got ${texts.length}`);
    for (const text of texts) {
        assert(!text.includes(snippetSentinel), "cache file leaked original slice snippet text");
        assert(!text.includes(expandedSentinel), "cache file leaked expanded snippet text");
        assert(!text.includes("```json"), "cache file leaked raw fenced model response");
        assert(!text.includes("You classify one API semantic slice for static taint modeling."), "cache file leaked prompt system text");
    }
}

async function testSemanticFlowItemCacheShortcut(rootDir: string): Promise<void> {
    const cacheRoot = path.join(rootDir, "item_shortcut");
    resetDir(cacheRoot);
    const anchor = buildAnchor("cache.item.anchor", "emitValue");
    const initialSlice = buildSlice(anchor.id, 0, "itemShortcut(value)");
    const cache = new SemanticFlowSessionCache({
        rootDir: cacheRoot,
        mode: "rw",
    });

    let firstModelCalls = 0;
    let firstExpandCalls = 0;
    const firstDecider = createSemanticFlowLlmDecider({
        model: "mock-item-shortcut",
        sessionCache: cache,
        async modelInvoker(input) {
            firstModelCalls++;
            const round = extractRound(input.user);
            if (round === 0) {
                return JSON.stringify({
                    status: "need-more-evidence",
                    draft: {
                        inputs: [{ slot: "arg", index: 0 }],
                        outputs: [{ slot: "result" }],
                        transfers: [],
                        confidence: "medium",
                        ruleKind: "transfer",
                    },
                    request: {
                        kind: "q_wrap",
                        focus: {
                            from: "arg0",
                            to: "ret",
                        },
                        scope: {
                            owner: "CacheOwner",
                            locality: "method",
                            surface: "emitValue",
                        },
                        budgetClass: "body_local",
                        why: ["need wrapper body"],
                        ask: "show the wrapper body",
                    },
                });
            }
            return JSON.stringify({
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
            });
        },
    });
    const firstExpander: SemanticFlowExpander = {
        async expand(input) {
            firstExpandCalls++;
            return {
                slice: {
                    ...input.slice,
                    round: input.round + 1,
                    observations: [...input.slice.observations, "wrapper body recovered"],
                    snippets: [...input.slice.snippets, { label: "expanded", code: "expandedShortcut(value)" }],
                    notes: [...(input.slice.notes || []), input.deficit.ask],
                },
                delta: {
                    id: "delta.cache.item.shortcut",
                    newObservations: ["wrapper body recovered"],
                    newSnippets: [{ label: "expanded", code: "expandedShortcut(value)" }],
                    newCompanions: [],
                    effective: true,
                },
            };
        },
    };

    const firstRun = await runSemanticFlowPipeline(
        [{ anchor, initialSlice }],
        firstDecider,
        firstExpander,
        {
            maxRounds: 1,
            model: "mock-item-shortcut",
            sessionCache: cache,
        },
    );
    assert(firstRun.items[0]?.resolution === "resolved", "expected first item-cache run to resolve");
    assert(firstModelCalls === 2, `expected first item-cache run to call LLM twice, got ${firstModelCalls}`);
    assert(firstExpandCalls === 1, `expected first item-cache run to expand once, got ${firstExpandCalls}`);

    let secondModelCalls = 0;
    let secondExpandCalls = 0;
    const secondDecider = createSemanticFlowLlmDecider({
        model: "mock-item-shortcut",
        sessionCache: cache,
        async modelInvoker() {
            secondModelCalls++;
            throw new Error("item cache hit should bypass the LLM");
        },
    });
    const secondExpander: SemanticFlowExpander = {
        async expand() {
            secondExpandCalls++;
            throw new Error("item cache hit should bypass the expander");
        },
    };

    const secondRun = await runSemanticFlowPipeline(
        [{ anchor, initialSlice }],
        secondDecider,
        secondExpander,
        {
            maxRounds: 1,
            model: "mock-item-shortcut",
            sessionCache: cache,
        },
    );
    const stats = cache.getStats();

    assert(secondRun.items[0]?.resolution === "resolved", "expected cached item run to resolve");
    assert(secondRun.items[0]?.classification === "rule", "expected cached item run to preserve classification");
    assert((secondRun.items[0]?.history.length || 0) === 2, "expected cached item run to restore round history");
    assert(secondModelCalls === 0, `expected cached item run to skip LLM, got ${secondModelCalls}`);
    assert(secondExpandCalls === 0, `expected cached item run to skip expander, got ${secondExpandCalls}`);
    assert(stats.itemCacheHitCount === 1, `expected itemCacheHitCount=1, got ${stats.itemCacheHitCount}`);
}

async function main(): Promise<void> {
    const rootDir = path.resolve("tmp/test_runs/runtime/semanticflow_llm_session_cache/latest");
    resetDir(rootDir);

    await testSemanticFlowLlmSessionCacheHit(rootDir);
    await testSemanticFlowLlmSessionCacheInvalidateModel(rootDir);
    await testSemanticFlowLlmSessionCacheNoRaw(rootDir);
    await testSemanticFlowItemCacheShortcut(rootDir);

    console.log("PASS test_semanticflow_llm_session_cache");
}

main().catch(error => {
    console.error("FAIL test_semanticflow_llm_session_cache");
    console.error(error);
    process.exit(1);
});
