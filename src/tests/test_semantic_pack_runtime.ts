import * as fs from "fs";
import * as path from "path";
import {
    collectFiniteStringCandidatesFromValue,
    collectParameterAssignStmts,
    resolveMethodsFromCallable,
} from "../core/kernel/contracts/SemanticPack";
import { loadSemanticPacks } from "../core/orchestration/packs/PackLoader";
import { createSemanticPackRuntime } from "../core/orchestration/packs/PackRuntime";
import { TaintFact } from "../core/kernel/TaintFact";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

async function main(): Promise<void> {
    const fixtureRoot = path.resolve("tests/fixtures/semantic_pack_runtime");
    const externalPackDir = path.join(fixtureRoot, "external_packs");
    const packDir = path.join(fixtureRoot, "demo_pack");

    const externalPacks = loadSemanticPacks({
        includeBuiltinPacks: false,
        packDirs: [externalPackDir],
    });
    assert(externalPacks.packs.length === 1, `expected 1 external pack, got ${externalPacks.packs.length}`);
    assert(externalPacks.packs[0].id === "external.custom_pack", "unexpected external pack id");
    assert(
        !externalPacks.packs.some(pack => pack.id === "external.disabled_pack"),
        "file-disabled semantic packs should not be loaded",
    );

    const packResult = loadSemanticPacks({
        includeBuiltinPacks: false,
        packDirs: [packDir],
    });
    assert(packResult.packs.length === 1, "expected exactly one semantic pack");
    assert(packResult.packs[0].id === "fixture.runtime", "unexpected semantic pack id");
    assert(packResult.loadedFiles.length === 1, "semantic pack loader should load exactly one file");
    assert(
        !packResult.packs.some(pack => pack.id === "fixture.runtime.disabled_inline"),
        "inline-disabled semantic packs should not be loaded",
    );

    const builtinResult = loadSemanticPacks({
        disabledPackIds: ["harmony.router"],
    });
    assert(
        !builtinResult.packs.some(pack => pack.id === "harmony.router"),
        "builtin disabled pack should not be present in load result",
    );
    assert(
        builtinResult.packs.some(pack => pack.id === "harmony.appstorage"),
        "builtin packs should still be discoverable",
    );
    const disabledExternalResult = loadSemanticPacks({
        includeBuiltinPacks: false,
        packDirs: [externalPackDir],
        disabledPackIds: ["external.custom_pack"],
    });
    assert(
        disabledExternalResult.packs.length === 0,
        "disable-packs should also disable external semantic packs",
    );
    assert(
        disabledExternalResult.warnings.length === 0,
        "disable-packs should not warn when a file-disabled semantic pack shares the same directory",
    );
    const disabledInlineByIdResult = loadSemanticPacks({
        includeBuiltinPacks: false,
        packDirs: [packDir],
        disabledPackIds: ["fixture.runtime.disabled_inline"],
    });
    assert(
        disabledInlineByIdResult.warnings.length === 0,
        "disable-packs should not warn for inline-disabled semantic packs that are present but disabled in-file",
    );

    const cwdProbeDir = path.resolve("tmp/phase8/semantic_pack_runtime/cwd_probe");
    fs.mkdirSync(cwdProbeDir, { recursive: true });
    const originalCwd = process.cwd();
    let builtinFromNestedCwd;
    try {
        process.chdir(cwdProbeDir);
        builtinFromNestedCwd = loadSemanticPacks({
            disabledPackIds: ["harmony.router"],
        });
    } finally {
        process.chdir(originalCwd);
    }
    assert(
        builtinFromNestedCwd.packs.some(pack => pack.id === "harmony.appstorage"),
        "builtin packs should still resolve when cwd is not the project root",
    );
    assert(
        !builtinFromNestedCwd.packs.some(pack => pack.id === "harmony.router"),
        "disabled builtin pack should remain disabled under nested cwd",
    );

    const builtinSourceRoot = path.resolve("src/packs");
    const routerPackFile = path.join(builtinSourceRoot, "harmony", "router.pack.ts");
    const routerPackBackupFile = `${routerPackFile}.bak`;
    fs.rmSync(routerPackBackupFile, { force: true });
    fs.renameSync(routerPackFile, routerPackBackupFile);
    let deletedBuiltinResult;
    try {
        deletedBuiltinResult = loadSemanticPacks({
            builtinPackDirs: [builtinSourceRoot],
        });
    } finally {
        fs.renameSync(routerPackBackupFile, routerPackFile);
    }
    assert(
        !deletedBuiltinResult.packs.some(pack => pack.id === "harmony.router"),
        "physically deleting a builtin pack file should remove that capability",
    );
    assert(
        deletedBuiltinResult.packs.some(pack => pack.id === "harmony.appstorage"),
        "remaining builtin packs should still load after one pack file is removed",
    );

    const fakeNode = {
        getID() {
            return 7;
        },
    } as any;
    const queries = {
        resolveMethodsFromCallable,
        collectParameterAssignStmts,
        collectFiniteStringCandidatesFromValue,
    };
    const seedFact = new TaintFact(fakeNode, "fixture.source", 7);
    const runtime = createSemanticPackRuntime(packResult.packs, {
        scene: null as any,
        pag: null as any,
        allowedMethodSignatures: undefined,
        fieldToVarIndex: new Map<string, Set<number>>(),
        queries,
        log: () => {},
    });
    const emissions = runtime.emitForFact({
        scene: null as any,
        pag: null as any,
        allowedMethodSignatures: undefined,
        fieldToVarIndex: new Map<string, Set<number>>(),
        queries,
        log: () => {},
        fact: seedFact,
        node: fakeNode,
    });
    assert(runtime.listPackIds().length === 1, "runtime should expose one pack id");
    assert(emissions.length === 1, "pack runtime should emit one fact");
    assert(emissions[0].reason === "Fixture-Pack", "unexpected pack emission reason");
    assert(emissions[0].fact.field?.join(".") === "pack", "unexpected emitted fact field path");
    const invokeEmissions = runtime.emitForInvoke({
        scene: null as any,
        pag: null as any,
        allowedMethodSignatures: undefined,
        fieldToVarIndex: new Map<string, Set<number>>(),
        queries,
        log: () => {},
        fact: seedFact,
        node: fakeNode,
        stmt: {
            containsInvokeExpr() {
                return true;
            },
        } as any,
        invokeExpr: {} as any,
        callSignature: "fixture.call",
        methodName: "fixtureMethod",
        declaringClassName: "FixtureClass",
        args: [],
        baseValue: undefined,
        resultValue: undefined,
    });
    assert(invokeEmissions.length === 1, "pack runtime should emit one invoke fact");
    assert(invokeEmissions[0].reason === "Fixture-Invoke", "unexpected invoke emission reason");
    assert(invokeEmissions[0].fact.field?.join(".") === "invoke", "unexpected invoke emitted field path");
    assert(
        runtime.shouldSkipCopyEdge({
            scene: null as any,
            pag: null as any,
            node: fakeNode,
            contextId: 7,
        }),
        "pack runtime should support copy-edge suppression",
    );
    console.log("PASS test_semantic_pack_runtime");
    console.log(`external_pack_count=${externalPacks.packs.length}`);
    console.log(`builtin_pack_count=${builtinResult.packs.length}`);
    console.log(`loaded_pack_file=${path.basename(packResult.loadedFiles[0])}`);
    console.log(`loaded_pack_extension=${path.extname(packResult.loadedFiles[0])}`);
}

main().catch((error) => {
    console.error("FAIL test_semantic_pack_runtime");
    console.error(error);
    process.exit(1);
});
