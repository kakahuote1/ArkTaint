"use strict";
/*
 * Copyright (c) 2024-2025 Huawei Device Co., Ltd.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.StaticSingleAssignmentFormer = void 0;
const Expr_1 = require("../core/base/Expr");
const Local_1 = require("../core/base/Local");
const Stmt_1 = require("../core/base/Stmt");
const DominanceFinder_1 = require("../core/graph/DominanceFinder");
const DominanceTree_1 = require("../core/graph/DominanceTree");
class StaticSingleAssignmentFormer {
    transformBody(body) {
        let cfg = body.getCfg();
        let blockToDefs = new Map();
        let localToBlocks = new Map();
        for (const block of cfg.getBlocks()) {
            let defs = new Set();
            for (const stmt of block.getStmts()) {
                this.transformStmt(stmt, defs, localToBlocks, block);
            }
            blockToDefs.set(block, defs);
        }
        let dominanceFinder = new DominanceFinder_1.DominanceFinder(cfg);
        let blockToPhiStmts = this.decideBlockToPhiStmts(body, dominanceFinder, blockToDefs, localToBlocks);
        this.addPhiStmts(blockToPhiStmts, cfg, blockToDefs);
        let dominanceTree = new DominanceTree_1.DominanceTree(dominanceFinder);
        this.renameLocals(body, dominanceTree, blockToPhiStmts);
    }
    transformStmt(stmt, defs, localToBlocks, block) {
        var _a;
        if (stmt.getDef() != null && stmt.getDef() instanceof Local_1.Local) {
            let local = stmt.getDef();
            defs.add(local);
            if (localToBlocks.has(local)) {
                (_a = localToBlocks.get(local)) === null || _a === void 0 ? void 0 : _a.add(block);
            }
            else {
                let blcoks = new Set();
                blcoks.add(block);
                localToBlocks.set(local, blcoks);
            }
        }
    }
    decideBlockToPhiStmts(body, dominanceFinder, blockToDefs, localToBlocks) {
        let blockToPhiStmts = new Map();
        let blockToPhiLocals = new Map();
        let localToPhiBlock = new Map();
        for (const [_, local] of body.getLocals()) {
            localToPhiBlock.set(local, new Set());
            let phiBlocks = localToPhiBlock.get(local);
            let blocks = Array.from(localToBlocks.get(local));
            while (blocks.length !== 0) {
                let block = blocks.splice(0, 1)[0];
                let dfs = dominanceFinder.getDominanceFrontiers(block);
                for (const df of dfs) {
                    this.handleDf(blockToPhiStmts, blockToPhiLocals, phiBlocks, df, local, blockToDefs, blocks);
                }
            }
        }
        return blockToPhiStmts;
    }
    handleDf(blockToPhiStmts, blockToPhiLocals, phiBlocks, df, local, blockToDefs, blocks) {
        var _a, _b, _c, _d;
        if (!phiBlocks.has(df)) {
            phiBlocks.add(df);
            let phiStmt = this.createEmptyPhiStmt(local);
            if (blockToPhiStmts.has(df)) {
                (_a = blockToPhiStmts.get(df)) === null || _a === void 0 ? void 0 : _a.add(phiStmt);
                (_b = blockToPhiLocals.get(df)) === null || _b === void 0 ? void 0 : _b.add(local);
            }
            else {
                let phiStmts = new Set();
                phiStmts.add(phiStmt);
                blockToPhiStmts.set(df, phiStmts);
                let phiLocals = new Set();
                phiLocals.add(local);
                blockToPhiLocals.set(df, phiLocals);
            }
            (_c = blockToDefs.get(df)) === null || _c === void 0 ? void 0 : _c.add(local);
            if (!((_d = blockToDefs.get(df)) === null || _d === void 0 ? void 0 : _d.has(local))) {
                blocks.push(df);
            }
        }
    }
    handleBlockWithSucc(blockToPhiStmts, succ, blockToDefs, block, phiArgsNum) {
        var _a;
        for (const phi of blockToPhiStmts.get(succ)) {
            let local = phi.getDef();
            if ((_a = blockToDefs.get(block)) === null || _a === void 0 ? void 0 : _a.has(local)) {
                if (phiArgsNum.has(phi)) {
                    let num = phiArgsNum.get(phi);
                    phiArgsNum.set(phi, num + 1);
                }
                else {
                    phiArgsNum.set(phi, 1);
                }
            }
        }
    }
    addPhiStmts(blockToPhiStmts, cfg, blockToDefs) {
        let phiArgsNum = new Map();
        for (const block of cfg.getBlocks()) {
            let succs = Array.from(block.getSuccessors());
            for (const succ of succs) {
                if (blockToPhiStmts.has(succ)) {
                    this.handleBlockWithSucc(blockToPhiStmts, succ, blockToDefs, block, phiArgsNum);
                }
            }
        }
        for (const block of blockToPhiStmts.keys()) {
            let phis = blockToPhiStmts.get(block);
            let phisTocheck = new Set(phis);
            for (const phi of phisTocheck) {
                if (phiArgsNum.get(phi) < 2) {
                    phis.delete(phi);
                }
            }
            for (const phi of phis) {
                cfg.insertBefore(phi, block.getHead());
            }
        }
    }
    renameUseAndDef(stmt, localToNameStack, nextFreeIdx, newLocals, newPhiStmts) {
        var _a;
        let uses = stmt.getUses();
        if (uses.length > 0 && !this.constainsPhiExpr(stmt)) {
            for (const use of uses) {
                if (use instanceof Local_1.Local) {
                    let nameStack = localToNameStack.get(use);
                    let newUse = nameStack[nameStack.length - 1];
                    stmt.replaceUse(use, newUse);
                }
            }
        }
        // rename def
        let def = stmt.getDef();
        if (def != null && def instanceof Local_1.Local) {
            let newName = def.getName() + '#' + nextFreeIdx;
            nextFreeIdx++;
            let newDef = new Local_1.Local(newName);
            newDef.setOriginalValue(def);
            newLocals.add(newDef);
            (_a = localToNameStack.get(def)) === null || _a === void 0 ? void 0 : _a.push(newDef);
            stmt.setLeftOp(newDef);
            if (this.constainsPhiExpr(stmt)) {
                newPhiStmts.add(stmt);
            }
        }
        return nextFreeIdx;
    }
    renameLocals(body, dominanceTree, blockToPhiStmts) {
        let newLocals = new Set(body.getLocals().values());
        let localToNameStack = new Map();
        for (const local of newLocals) {
            localToNameStack.set(local, new Array());
        }
        let blockStack = new Array();
        let visited = new Set();
        let dfsBlocks = dominanceTree.getAllNodesDFS();
        let nextFreeIdx = 0;
        for (const block of dfsBlocks) {
            let newPhiStmts = new Set();
            for (const stmt of block.getStmts()) {
                // rename uses and def
                nextFreeIdx = this.renameUseAndDef(stmt, localToNameStack, nextFreeIdx, newLocals, newPhiStmts);
            }
            visited.add(block);
            blockStack.push(block);
            if (blockToPhiStmts.has(block)) {
                blockToPhiStmts.set(block, newPhiStmts);
            }
            // rename phiStmts' args
            let succs = Array.from(block.getSuccessors());
            for (const succ of succs) {
                if (!blockToPhiStmts.has(succ)) {
                    continue;
                }
                let phiStmts = blockToPhiStmts.get(succ);
                for (const phiStmt of phiStmts) {
                    let def = phiStmt.getDef();
                    let oriDef = this.getOriginalLocal(def, new Set(localToNameStack.keys()));
                    let nameStack = localToNameStack.get(oriDef);
                    let arg = nameStack[nameStack.length - 1];
                    this.addNewArgToPhi(phiStmt, arg, block);
                }
            }
            // if a block's children in dominance tree are visited, remove it
            this.removeVisitedTree(blockStack, dominanceTree, visited, localToNameStack);
        }
        body.setLocals(newLocals);
    }
    removeVisitedTree(blockStack, dominanceTree, visited, localToNameStack) {
        var _a;
        let top = blockStack[blockStack.length - 1];
        let children = dominanceTree.getChildren(top);
        while (this.containsAllChildren(visited, children)) {
            blockStack.pop();
            for (const stmt of top.getStmts()) {
                let def = stmt.getDef();
                if (def != null && def instanceof Local_1.Local) {
                    let oriDef = this.getOriginalLocal(def, new Set(localToNameStack.keys()));
                    (_a = localToNameStack.get(oriDef)) === null || _a === void 0 ? void 0 : _a.pop();
                }
            }
            // next block to check
            if (blockStack.length > 0) {
                top = blockStack[blockStack.length - 1];
                children = dominanceTree.getChildren(top);
            }
            else {
                break;
            }
        }
    }
    constainsPhiExpr(stmt) {
        if (stmt instanceof Stmt_1.ArkAssignStmt && stmt.getUses().length > 0) {
            for (const use of stmt.getUses()) {
                if (use instanceof Expr_1.ArkPhiExpr) {
                    return true;
                }
            }
        }
        return false;
    }
    getOriginalLocal(local, locals) {
        if (locals.has(local)) {
            return local;
        }
        let hashPos = local.getName().indexOf('#');
        let oriName = local.getName().substring(0, hashPos);
        for (const oriLocal of locals) {
            if (oriLocal.getName() === oriName) {
                return oriLocal;
            }
        }
        return null;
    }
    addNewArgToPhi(phiStmt, arg, block) {
        for (let use of phiStmt.getUses()) {
            if (use instanceof Expr_1.ArkPhiExpr) {
                let phiExpr = use;
                let args = phiExpr.getArgs();
                let argToBlock = phiExpr.getArgToBlock();
                args.push(arg);
                argToBlock.set(arg, block);
                phiExpr.setArgs(args);
                phiExpr.setArgToBlock(argToBlock);
                break;
            }
        }
    }
    containsAllChildren(blockSet, children) {
        for (const child of children) {
            if (!blockSet.has(child)) {
                return false;
            }
        }
        return true;
    }
    createEmptyPhiStmt(local) {
        let phiExpr = new Expr_1.ArkPhiExpr();
        return new Stmt_1.ArkAssignStmt(local, phiExpr);
    }
}
exports.StaticSingleAssignmentFormer = StaticSingleAssignmentFormer;
