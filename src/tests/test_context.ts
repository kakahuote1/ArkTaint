
import { Scene } from "../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../arkanalyzer/out/src/Config";
import { TaintPropagationEngine } from "../core/TaintPropagationEngine";
import * as fs from 'fs';
import * as path from 'path';

async function runTest() {
    let projectDir = "d:/cursor/workplace/ArkTaint/tests/demo/context_sensitive";

    let config = new SceneConfig();
    config.buildFromProjectDir(projectDir);

    let scene = new Scene();
    scene.buildSceneFromProjectDir(config);
    scene.inferTypes();

    let files = fs.readdirSync(projectDir).filter(f => f.endsWith('.ets'));
    let stats = { passed: 0, failed: 0, total: 0 };

    // Test both k=0 (context-insensitive) and k=1 (context-sensitive)
    for (let k of [0, 1]) {
        console.log(`\n${'='.repeat(60)}`);
        console.log(`========== Testing with k=${k} ==========`);
        console.log(`${'='.repeat(60)}`);

        let kStats = { passed: 0, failed: 0, total: 0 };

        for (let file of files) {
            if (file === 'taint_mock.ts' || file === 'package.json') continue;

            let testName = path.basename(file, '.ets');
            let expected = testName.endsWith('_T'); // _T = expect flow, _F = no flow

            console.log(`\n---------------------------------------------------`);
            console.log(`Testing: ${testName} (k=${k}, Expect: ${expected ? 'FLOW' : 'NO FLOW'})`);

            try {
                let engine = new TaintPropagationEngine(scene, k);
                await engine.buildPAG(testName);

                // Find entry method
                let entryMethod = scene.getMethods().find(m => m.getName() === testName);
                if (!entryMethod) {
                    console.error(`  ❌ Method ${testName} not found in scene.`);
                    kStats.failed++;
                    kStats.total++;
                    continue;
                }

                // Find seeds (taint_src parameter)
                let methodBody = entryMethod.getBody();
                if (!methodBody) {
                    console.error(`  ❌ Method ${testName} has no body.`);
                    kStats.failed++;
                    kStats.total++;
                    continue;
                }

                let localsMap = methodBody.getLocals();
                let seeds: any[] = [];
                for (let local of localsMap.values()) {
                    if (local.getName() === 'taint_src' || local.getName().startsWith('p')) {
                        let nodes = engine.pag.getNodesByValue(local);
                        if (nodes) {
                            for (let nodeId of nodes.values()) {
                                seeds.push(engine.pag.getNode(nodeId));
                            }
                        }
                    }
                }

                if (seeds.length === 0) {
                    console.error(`  ⚠️ No seeds found.`);
                    kStats.failed++;
                    kStats.total++;
                    continue;
                }

                console.log(`  Seeding with ${seeds.length} nodes...`);
                engine.propagateWithSeeds(seeds);

                let flows = engine.detectSinks("Sink");
                let detected = flows.length > 0;

                if (detected === expected) {
                    console.log(`  ✅ PASSED. (Detected: ${detected}, Expected: ${expected})`);
                    kStats.passed++;
                } else {
                    console.log(`  ❌ FAILED. (Detected: ${detected}, Expected: ${expected})`);
                    if (detected) {
                        console.log("     Unexpected flow:");
                        flows.forEach(f => console.log(`       ${f.toString()}`));
                    }
                    kStats.failed++;
                }
            } catch (e) {
                console.error(`  ❌ Error: ${e}`);
                kStats.failed++;
            }
            kStats.total++;
        }

        console.log(`\n${'='.repeat(60)}`);
        console.log(`k=${k} Results: Run: ${kStats.total}, Passed: ${kStats.passed}, Failed: ${kStats.failed}`);
        console.log(`${'='.repeat(60)}`);
    }
}

runTest().catch(console.error);
