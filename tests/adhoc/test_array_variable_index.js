const path = require("path");
const { Scene } = require("../../arkanalyzer/out/src/Scene");
const { SceneConfig } = require("../../arkanalyzer/out/src/Config");
const { ArkAssignStmt } = require("../../arkanalyzer/out/src/core/base/Stmt");
const { ArkArrayRef, ArkParameterRef } = require("../../arkanalyzer/out/src/core/base/Ref");
const { Local } = require("../../arkanalyzer/out/src/core/base/Local");
const { TaintPropagationEngine } = require("../../out/core/TaintPropagationEngine");

function findEntryMethod(scene, entryName) {
    const method = scene.getMethods().find(m => m.getName() === entryName);
    if (!method) {
        throw new Error(`Entry method not found: ${entryName}`);
    }
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

function inspectArrayIndexIR(entryMethod) {
    const cfg = entryMethod.getCfg();
    const lines = [];
    if (!cfg) return lines;

    for (const stmt of cfg.getStmts()) {
        if (stmt instanceof ArkAssignStmt) {
            const left = stmt.getLeftOp();
            const right = stmt.getRightOp();

            if (left instanceof ArkArrayRef) {
                lines.push(`WRITE index=${left.getIndex()} stmt=${stmt.toString()}`);
            }
            if (right instanceof ArkArrayRef) {
                lines.push(`LOAD index=${right.getIndex()} stmt=${stmt.toString()}`);
            }
        }

        if (stmt.containsInvokeExpr && stmt.containsInvokeExpr()) {
            const invokeExpr = stmt.getInvokeExpr();
            if (!invokeExpr || !invokeExpr.getArgs) continue;
            for (const arg of invokeExpr.getArgs()) {
                if (arg instanceof ArkArrayRef) {
                    lines.push(`ARG index=${arg.getIndex()} stmt=${stmt.toString()}`);
                }
            }
        }
    }
    return lines;
}

async function detectFlow(scene, entryName) {
    const engine = new TaintPropagationEngine(scene, 1, {});
    engine.verbose = false;
    await engine.buildPAG(entryName);

    const entryMethod = findEntryMethod(scene, entryName);
    const seedNodes = collectSeedNodes(engine, entryMethod);
    if (seedNodes.length === 0) {
        throw new Error(`No seed nodes found in ${entryName}`);
    }

    engine.propagateWithSeeds(seedNodes);
    const flows = engine.detectSinks("Sink");
    return flows.length > 0;
}

async function main() {
    const sourceDir = path.resolve("tests/adhoc/array_variable_index");
    const config = new SceneConfig();
    config.buildFromProjectDir(sourceDir);
    const scene = new Scene();
    scene.buildSceneFromProjectDir(config);
    scene.inferTypes();

    const cases = [
        "array_var_index_same_local_001_T",
        "array_var_index_diff_local_002_F",
        "array_var_index_alias_local_003_T",
        "array_var_index_binop_local_004_T",
    ];

    console.log("array variable index verification");
    console.log(`source_dir=${sourceDir}`);

    for (const c of cases) {
        const method = findEntryMethod(scene, c);
        const ir = inspectArrayIndexIR(method);
        const hasFlow = await detectFlow(scene, c);
        console.log(`\ncase=${c}`);
        console.log(`flow=${hasFlow}`);
        console.log(`ir_count=${ir.length}`);
        for (const line of ir.slice(0, 6)) {
            console.log(`  ${line}`);
        }
    }
}

main().catch(err => {
    console.error(err);
    process.exitCode = 1;
});
