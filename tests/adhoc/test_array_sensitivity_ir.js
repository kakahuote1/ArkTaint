const path = require("path");
const { Scene } = require("../../arkanalyzer/out/src/Scene");
const { SceneConfig } = require("../../arkanalyzer/out/src/Config");
const { ArkAssignStmt } = require("../../arkanalyzer/out/src/core/base/Stmt");
const { ArkArrayRef, ArkParameterRef } = require("../../arkanalyzer/out/src/core/base/Ref");
const { Local } = require("../../arkanalyzer/out/src/core/base/Local");
const { TaintPropagationEngine } = require("../../out/core/TaintPropagationEngine");

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

function findEntryMethod(scene, entryName) {
    const method = scene.getMethods().find(m => m.getName() === entryName);
    if (!method) throw new Error(`Entry method not found: ${entryName}`);
    return method;
}

function collectSeedNodes(engine, entryMethod) {
    const seedNodes = [];
    const seen = new Set();
    const cfg = entryMethod.getCfg();
    if (!cfg) return seedNodes;

    for (const stmt of cfg.getStmts()) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        if (!(stmt.getRightOp() instanceof ArkParameterRef)) continue;
        const left = stmt.getLeftOp();
        if (!(left instanceof Local)) continue;
        if (left.getName() !== "taint_src") continue;
        const nodes = engine.pag.getNodesByValue(left);
        if (!nodes) continue;
        for (const id of nodes.values()) {
            if (seen.has(id)) continue;
            seen.add(id);
            seedNodes.push(engine.pag.getNode(id));
        }
    }
    return seedNodes;
}

function inspectArrayRefIR(entryMethod) {
    const cfg = entryMethod.getCfg();
    const lines = [];
    if (!cfg) return lines;

    for (const stmt of cfg.getStmts()) {
        if (stmt instanceof ArkAssignStmt) {
            const left = stmt.getLeftOp();
            const right = stmt.getRightOp();
            if (left instanceof ArkArrayRef) {
                lines.push(
                    `IR_ARRAY_WRITE stmt="${stmt.toString()}" base="${left.getBase()}" index="${left.getIndex()}"`
                );
            }
            if (right instanceof ArkArrayRef) {
                lines.push(
                    `IR_ARRAY_LOAD stmt="${stmt.toString()}" base="${right.getBase()}" index="${right.getIndex()}"`
                );
            }
        }

        if (stmt.containsInvokeExpr && stmt.containsInvokeExpr()) {
            const invokeExpr = stmt.getInvokeExpr();
            if (!invokeExpr || !invokeExpr.getArgs) continue;
            for (const arg of invokeExpr.getArgs()) {
                if (arg instanceof ArkArrayRef) {
                    lines.push(
                        `IR_ARRAY_ARG stmt="${stmt.toString()}" base="${arg.getBase()}" index="${arg.getIndex()}"`
                    );
                }
            }
        }
    }
    return lines;
}

async function detectFlowForEntry(scene, entryName) {
    const engine = new TaintPropagationEngine(scene, 1, {});
    engine.verbose = false;
    await engine.buildPAG(entryName);
    const entryMethod = findEntryMethod(scene, entryName);
    const seeds = collectSeedNodes(engine, entryMethod);
    assert(seeds.length > 0, `No taint_src parameter seed found in ${entryName}`);
    engine.propagateWithSeeds(seeds);
    const flows = engine.detectSinks("Sink");
    return flows.length > 0;
}

async function main() {
    const sourceDir = path.resolve("tests/demo/senior_full/field_sensitive/container");
    const config = new SceneConfig();
    config.buildFromProjectDir(sourceDir);
    const scene = new Scene();
    scene.buildSceneFromProjectDir(config);
    scene.inferTypes();

    const caseT = "array_001_T";
    const caseF = "array_002_F";

    const methodT = findEntryMethod(scene, caseT);
    const methodF = findEntryMethod(scene, caseF);
    const irT = inspectArrayRefIR(methodT);
    const irF = inspectArrayRefIR(methodF);

    assert(irT.length > 0, `No array IR evidence found in ${caseT}`);
    assert(irF.length > 0, `No array IR evidence found in ${caseF}`);

    const hasIdx0 = [...irT, ...irF].some(line => line.includes('index="0"'));
    const hasIdx1 = [...irT, ...irF].some(line => line.includes('index="1"'));
    assert(hasIdx0 && hasIdx1, "Expected indexed array IR with index 0 and 1.");

    const flowT = await detectFlowForEntry(scene, caseT);
    const flowF = await detectFlowForEntry(scene, caseF);

    assert(flowT, `${caseT} should have flow but got none.`);
    assert(!flowF, `${caseF} should be no-flow if array-sensitive, but flow was detected.`);

    console.log("PASS adhoc array-sensitive verification");
    console.log(`source_dir=${sourceDir}`);
    console.log(`ir_evidence_${caseT}=${irT.length}`);
    console.log(`ir_evidence_${caseF}=${irF.length}`);
    console.log(`flow_${caseT}=${flowT}`);
    console.log(`flow_${caseF}=${flowF}`);
    console.log("sample_ir_lines:");
    for (const line of [...irT.slice(0, 2), ...irF.slice(0, 2)]) {
        console.log(`  ${line}`);
    }
}

main().catch(err => {
    console.error(err);
    process.exitCode = 1;
});
