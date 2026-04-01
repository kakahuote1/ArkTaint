import * as fs from "fs";
import * as path from "path";
import {
    IncrementalCacheScope,
    loadIncrementalCache,
    resolveDirectoryTreeStamp,
    saveIncrementalCache,
    sameEntryFileStamp,
} from "../cli/analyzeIncremental";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

function main(): void {
    const fixtureRoot = path.resolve("tmp/test_runs/analyze/analyze_incremental_cache/latest");
    const sourceDir = path.resolve(fixtureRoot, "src");
    const nestedDir = path.resolve(sourceDir, "nested");
    const cachePath = path.resolve(fixtureRoot, "incremental.cache.json");
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
    fs.mkdirSync(nestedDir, { recursive: true });

    const sourceFile = path.resolve(nestedDir, "entry.ets");
    fs.writeFileSync(sourceFile, "let value = 1;\n", "utf-8");
    const stamp1 = resolveDirectoryTreeStamp(sourceDir);
    assert(stamp1, "expected initial directory stamp");

    fs.writeFileSync(sourceFile, "let value = 2;\n", "utf-8");
    const stamp2 = resolveDirectoryTreeStamp(sourceDir);
    assert(stamp2, "expected updated directory stamp");
    assert(!sameEntryFileStamp(stamp1, stamp2), "directory stamp should change after nested file mutation");

    const scopeA: IncrementalCacheScope = {
        repo: "/repo",
        k: 1,
        profile: "default",
        analysisFingerprint: "fingerprint-a",
    };
    const scopeB: IncrementalCacheScope = {
        ...scopeA,
        analysisFingerprint: "fingerprint-b",
    };

    const cache = new Map<string, { stamp: NonNullable<typeof stamp2>; result: { status: string } }>();
    cache.set("entry", {
        stamp: stamp2,
        result: { status: "ok" },
    });
    saveIncrementalCache(cachePath, scopeA, cache);

    const hit = loadIncrementalCache<{ status: string }>(cachePath, scopeA);
    const miss = loadIncrementalCache<{ status: string }>(cachePath, scopeB);
    assert(hit.size === 1, `expected cache hit for same analysis fingerprint, got ${hit.size}`);
    assert(miss.size === 0, `expected cache miss for different analysis fingerprint, got ${miss.size}`);

    console.log("PASS test_analyze_incremental_cache");
    console.log(`stamp1=${stamp1.fingerprint}`);
    console.log(`stamp2=${stamp2.fingerprint}`);
    console.log(`cache_hit_size=${hit.size}`);
    console.log(`cache_miss_size=${miss.size}`);
}

try {
    main();
} catch (error) {
    console.error("FAIL test_analyze_incremental_cache");
    console.error(error);
    process.exit(1);
}

