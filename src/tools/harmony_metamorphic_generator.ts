import * as path from "path";
import { HarmonyMutatorGroup, generateHarmonyMutationDataset } from "../tests/metamorphic/HarmonyMetamorphicGenerator";

interface CliOptions {
    manifestPath: string;
    outputRoot: string;
    groups: HarmonyMutatorGroup[];
    maxCasesPerCategory: number;
    categoryPattern: RegExp;
    semanticAnchorHintsPath?: string;
}

function parseGroups(input: string): HarmonyMutatorGroup[] {
    const parts = input
        .split(",")
        .map(x => x.trim().toUpperCase())
        .filter(Boolean);
    const out: HarmonyMutatorGroup[] = [];
    for (const p of parts) {
        if (p === "A" || p === "B") {
            if (!out.includes(p)) out.push(p);
        }
    }
    return out.length > 0 ? out : ["A", "B"];
}

function parseArgs(argv: string[]): CliOptions {
    let manifestPath = "tests/benchmark/HarmonyBench/manifest.json";
    let outputRoot = "tmp/harmony_bench_metamorphic/generated";
    let groups: HarmonyMutatorGroup[] = ["A", "B"];
    let maxCasesPerCategory = 0;
    let categoryPattern = /^C[1-5]_/;
    let semanticAnchorHintsPath: string | undefined;

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--manifest" && i + 1 < argv.length) {
            manifestPath = argv[++i];
            continue;
        }
        if (arg.startsWith("--manifest=")) {
            manifestPath = arg.slice("--manifest=".length);
            continue;
        }
        if (arg === "--outputRoot" && i + 1 < argv.length) {
            outputRoot = argv[++i];
            continue;
        }
        if (arg.startsWith("--outputRoot=")) {
            outputRoot = arg.slice("--outputRoot=".length);
            continue;
        }
        if (arg === "--groups" && i + 1 < argv.length) {
            groups = parseGroups(argv[++i]);
            continue;
        }
        if (arg.startsWith("--groups=")) {
            groups = parseGroups(arg.slice("--groups=".length));
            continue;
        }
        if (arg === "--maxCasesPerCategory" && i + 1 < argv.length) {
            maxCasesPerCategory = Number(argv[++i]);
            continue;
        }
        if (arg.startsWith("--maxCasesPerCategory=")) {
            maxCasesPerCategory = Number(arg.slice("--maxCasesPerCategory=".length));
            continue;
        }
        if (arg === "--categoryRegex" && i + 1 < argv.length) {
            categoryPattern = new RegExp(argv[++i]);
            continue;
        }
        if (arg.startsWith("--categoryRegex=")) {
            categoryPattern = new RegExp(arg.slice("--categoryRegex=".length));
            continue;
        }
        if (arg === "--semanticAnchorHints" && i + 1 < argv.length) {
            semanticAnchorHintsPath = argv[++i];
            continue;
        }
        if (arg.startsWith("--semanticAnchorHints=")) {
            semanticAnchorHintsPath = arg.slice("--semanticAnchorHints=".length);
            continue;
        }
    }

    if (!Number.isFinite(maxCasesPerCategory) || maxCasesPerCategory < 0) {
        throw new Error(`Invalid --maxCasesPerCategory: ${maxCasesPerCategory}`);
    }

    return {
        manifestPath: path.resolve(manifestPath),
        outputRoot: path.resolve(outputRoot),
        groups,
        maxCasesPerCategory,
        categoryPattern,
        semanticAnchorHintsPath: semanticAnchorHintsPath ? path.resolve(semanticAnchorHintsPath) : undefined,
    };
}

function main(): void {
    const options = parseArgs(process.argv.slice(2));
    const dataset = generateHarmonyMutationDataset({
        manifestPath: options.manifestPath,
        outputRoot: options.outputRoot,
        groups: options.groups,
        maxCasesPerCategory: options.maxCasesPerCategory,
        categoryIdPattern: options.categoryPattern,
        semanticAnchorHintsPath: options.semanticAnchorHintsPath,
    });

    console.log("====== Harmony Metamorphic Dataset Generated ======");
    console.log(`manifest=${dataset.manifestPath}`);
    console.log(`outputRoot=${dataset.outputRoot}`);
    console.log(`groups=${dataset.groups.join(",")}`);
    console.log(`selectedCategories=${dataset.selectedCategoryIds.join(",")}`);
    console.log(`maxCasesPerCategory=${dataset.maxCasesPerCategory}`);
    console.log(`totalCases=${dataset.totalCases}`);
    console.log(`totalMutations=${dataset.totalMutations}`);
    console.log(`generatedManifest=${path.join(dataset.outputRoot, "generated_manifest.json")}`);
    if (options.semanticAnchorHintsPath) {
        console.log(`semanticAnchorHints=${options.semanticAnchorHintsPath}`);
    }
}

main();
