
import { Scene } from "../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../arkanalyzer/out/src/Config";
import { TaintPropagationEngine } from "../core/TaintPropagationEngine";
import * as fs from 'fs';
import * as path from 'path';

// Helper to determine if a string is a valid ArkTaint signature
function isSignature(s: string): boolean {
    return s.includes("<") && s.includes(">");
}

async function runTest() {
    let projectDir = "d:/cursor/workplace/ArkTaint/tests/demo/senior_field";

    let config = new SceneConfig();
    config.buildFromProjectDir(projectDir);

    let scene = new Scene();
    scene.buildSceneFromProjectDir(config);

    scene.inferTypes();

    let engine = new TaintPropagationEngine(scene);

    // We need to build PAG for the whole project once
    console.log("Building PAG for Senior Test Suite...");
    // Hack: We need a valid entry point or build whole project.
    // Let's try to build PAG for one of the files as entry, 
    // but since we want to test ALL files, strict entry point might be tricky.
    // However, TaintPropagationEngine.buildPAG() now takes an entry method name.
    // IF we pass a name that exists, it builds the PAG reachable from it.
    // BUT we want to test disjoint files.
    // Arkanalyzer's PointerAnalysis typically builds for all entry points it can find if configured so.
    // Let's see if we can use a dummy entry or if we need to iterate.

    // Strategy: 
    // 1. Iterate each file in the dir.
    // 2. Find the exported function name (filename without extension).
    // 3. Re-build PAG (or ideally reuse, but graph might be disjoint) for THAT entry point.
    // 4. Propagate and Check.

    // Note: Re-using 'engine' instance might accumulate state? 
    // Yes, PAG is built once per engine currently in our code?
    // Let's check buildPAG code ... it creates `new Pag()`.
    // So if we call buildPAG multiple times on same engine, it might overwrite the PAG.
    // Let's create a new engine for each test file to be safe.

    let files = fs.readdirSync(projectDir).filter(f => f.endsWith('.ets'));
    let stats = { passed: 0, failed: 0, total: 0 };

    for (let file of files) {
        if (file === 'taint_mock.ts') continue;

        let testName = path.basename(file, '.ets');
        let expected = file.endsWith('_T.ets'); // Expect Taint Flow

        console.log(`\n---------------------------------------------------`);
        console.log(`Testing: ${testName} (Expect: ${expected ? 'FLOW' : 'NO FLOW'})`);

        try {
            // New Engine for isolation
            let localEngine = new TaintPropagationEngine(scene);

            // Assume the function name matches the filename (senior's convention)
            // e.g. constructor_field_001_T.ets -> function constructor_field_001_T()
            await localEngine.buildPAG(testName);

            // Source: Taint the arguments of the entry function
            // We need to find the MethodSignature of the entry function
            let entryMethod = scene.getMethods().find(m => m.getName() === testName);
            if (!entryMethod) {
                console.error(`  ❌ Method ${testName} not found in scene.`);
                stats.failed++;
                continue;
            }

            // Find arguments of the entry method
            // We need to look up PAG nodes for the parameters.
            // Arkanalyzer maps parameters to Local variables in the body?
            // Or does it have explicit ParameterNodes?
            // In PAG, parameters are usually nodes.
            // Let's get the 'PagNode' corresponding to the parameters of 'entryMethod'.

            // PagBuilder implementation detail:
            // Parameters are locals like '0: this', '1: param0', etc.
            // Let's iterate the body locals and find parameter locals.

            let methodBody = entryMethod.getBody();
            if (!methodBody) {
                console.error(`  ❌ Method ${testName} has no body.`);
                stats.failed++;
                continue;
            }

            let localsMap = methodBody.getLocals(); // Returns Map<string, Local>
            let seeds: any[] = []; // PagNode[]

            for (let local of localsMap.values()) {
                // Verify if it's a parameter?
                // Arkanalyzer Local doesn't explicitly flag 'isParameter' easily?
                // Wait, method signature has parameters.
                // Let's assume the first few locals are parameters or look for 'taint_src' name if possible.
                // In senior's test: 'taint_src'. 
                if (local.getName() === 'taint_src' || local.getName().startsWith('p')) {
                    let nodes = localEngine.pag.getNodesByValue(local);
                    if (nodes) {
                        for (let nodeId of nodes.values()) {
                            seeds.push(localEngine.pag.getNode(nodeId));
                        }
                    }
                }
            }

            if (seeds.length === 0) {
                console.error(`  ⚠️ No seeds found (param 'taint_src'?).`);
                // Fallback: Taint ALL parameters logic?
                // Let's try to check parameter list.
                // For now, fail if no seeds.
                stats.failed++;
                continue;
            }

            console.log(`  Seeding with ${seeds.length} nodes (args)...`);
            localEngine.propagateWithSeeds(seeds);

            console.log("Detecting Flows...");
            let flows = localEngine.detectSinks("Sink"); // Case sensitive 'sink' or 'Sink'? Mock has 'Sink'.

            let detected = flows.length > 0;
            if (detected === expected) {
                console.log(`  ✅ PASSED. (Detected: ${detected}, Expected: ${expected})`);
                stats.passed++;
            } else {
                console.log(`  ❌ FAILED. (Detected: ${detected}, Expected: ${expected})`);
                if (detected) {
                    console.log("     Unexpected flow:");
                    flows.forEach(f => console.log(f.toString()));
                }
                stats.failed++;
            }

        } catch (e) {
            console.error(`  ❌ Error: ${e}`);
            stats.failed++;
        }
        stats.total++;
    }

    console.log(`\n===================================================`);
    console.log(`Run: ${stats.total}, Passed: ${stats.passed}, Failed: ${stats.failed}`);
}

runTest().catch(console.error);
