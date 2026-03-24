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
exports.AbstractFlowGraph = exports.CodeBlockType = void 0;
const Stmt_1 = require("../core/base/Stmt");
var CodeBlockType;
(function (CodeBlockType) {
    CodeBlockType[CodeBlockType["NORMAL"] = 0] = "NORMAL";
    CodeBlockType[CodeBlockType["IF"] = 1] = "IF";
    CodeBlockType[CodeBlockType["ELSE"] = 2] = "ELSE";
    CodeBlockType[CodeBlockType["BREAK"] = 3] = "BREAK";
    CodeBlockType[CodeBlockType["CONTINUE"] = 4] = "CONTINUE";
    CodeBlockType[CodeBlockType["DO"] = 5] = "DO";
    CodeBlockType[CodeBlockType["DO_WHILE"] = 6] = "DO_WHILE";
    CodeBlockType[CodeBlockType["WHILE"] = 7] = "WHILE";
    CodeBlockType[CodeBlockType["FOR"] = 8] = "FOR";
    CodeBlockType[CodeBlockType["COMPOUND_END"] = 9] = "COMPOUND_END";
    CodeBlockType[CodeBlockType["TRY"] = 10] = "TRY";
    CodeBlockType[CodeBlockType["CATCH"] = 11] = "CATCH";
    CodeBlockType[CodeBlockType["FINALLY"] = 12] = "FINALLY";
})(CodeBlockType = exports.CodeBlockType || (exports.CodeBlockType = {}));
class AbstractFlowGraph {
    constructor(cfg, traps) {
        this.nodes = [];
        this.structOf = new Map();
        this.structTypes = new Map();
        this.structBlocks = new Map();
        this.loopMap = new Map();
        this.block2NodeMap = new Map();
        for (const bb of cfg.getBlocks()) {
            let an = new AbstractNode();
            an.setBlock(bb);
            this.block2NodeMap.set(bb, an);
        }
        for (const bb of cfg.getBlocks()) {
            let an = this.block2NodeMap.get(bb);
            for (const succ of bb.getSuccessors()) {
                an.addSucc(this.block2NodeMap.get(succ));
            }
            for (const pred of bb.getPredecessors()) {
                an.addPred(this.block2NodeMap.get(pred));
            }
        }
        let trapRegions = this.buildTrap(traps);
        this.searchTrapFinallyNodes(trapRegions);
        this.trapsStructuralAnalysis(trapRegions);
        this.entry = this.block2NodeMap.get(cfg.getStartingBlock());
        this.entry = this.structuralAnalysis(this.entry);
    }
    getEntry() {
        return this.entry;
    }
    getForIncBlock(block) {
        let node = this.block2NodeMap.get(block);
        let loop = this.loopMap.get(node);
        return loop.inc.getBlock();
    }
    preOrder(node, callback, visitor = new Set()) {
        visitor.add(node);
        node.traversal(callback, CodeBlockType.NORMAL);
        for (const succ of node.getSucc()) {
            if (!visitor.has(succ)) {
                this.preOrder(succ, callback, visitor);
            }
        }
    }
    structuralAnalysis(entry, scope) {
        let preds = entry.getPred();
        let entryBak = entry;
        this.nodes = this.dfsPostOrder(entry, scope);
        this.entry = entry;
        this.buildCyclicStructural();
        // acyclic structural
        let postMax = this.nodes.length;
        let change = true;
        while (postMax > 1 && change) {
            change = false;
            for (let i = 0; i < postMax; i++) {
                let node = this.nodes[i];
                let nset = new Set();
                let rtype = this.identifyRegionType(node, nset, scope);
                if (!rtype) {
                    continue;
                }
                let p = this.reduce(rtype, nset);
                if (!p) {
                    continue;
                }
                scope === null || scope === void 0 ? void 0 : scope.add(p);
                if (nset.has(entry)) {
                    entry = p;
                }
                this.nodes = this.dfsPostOrder(entry, scope);
                change = postMax !== this.nodes.length;
                postMax = this.nodes.length;
            }
        }
        for (const pred of preds) {
            pred.replaceSucc(entryBak, entry);
            entry.addPred(pred);
        }
        return entry;
    }
    dfsPostOrder(node, scope, visitor = new Set(), postOrder = []) {
        visitor.add(node);
        for (const succ of node.getSucc()) {
            if (visitor.has(succ)) {
                continue;
            }
            if (scope && !scope.has(succ)) {
                continue;
            }
            this.dfsPostOrder(succ, scope, visitor, postOrder);
        }
        postOrder.push(node);
        return postOrder;
    }
    buildCyclicStructural() {
        for (const loop of this.prepareBuildLoops()) {
            let nset = new Set();
            for (const n of loop) {
                if (this.structOf.has(n)) {
                    nset.add(this.structOf.get(n));
                }
                else {
                    nset.add(n);
                }
            }
            let rtype = this.cyclicRegionType(nset);
            let region = this.createRegion(rtype, nset);
            region.revise();
            this.structTypes.set(region, rtype);
            let blocks = new Set();
            for (const s of nset) {
                this.handleRegion(s, region, blocks);
            }
            this.structBlocks.set(region, blocks);
            this.loopMap.set(region.header, region);
        }
    }
    handleRegion(s, region, blocks) {
        if (!this.structOf.has(s)) {
            this.structOf.set(s, region);
        }
        if (this.structBlocks.has(s)) {
            for (const b of this.structBlocks.get(s)) {
                blocks.add(b);
            }
        }
        else {
            blocks.add(s);
        }
    }
    prepareBuildLoops() {
        let dom = this.buildDominator();
        let loops = [];
        for (const header of this.nodes) {
            let innermost;
            let longest = 0;
            let backEdges = this.getBackEdges(dom, header);
            if (backEdges.size === 0) {
                continue;
            }
            if (this.isSelfLoopNode(header)) {
                loops.push(new Set([header]));
            }
            for (const start of backEdges) {
                let loop = this.naturalLoop(start, header);
                if (!innermost || loop.size > longest) {
                    innermost = loop;
                    longest = loop.size;
                }
            }
            loops.push(innermost);
        }
        loops.sort((a, b) => a.size - b.size);
        return loops;
    }
    buildDominator() {
        let domin = new Map();
        domin.set(this.entry, new Set([this.entry]));
        for (const node of this.nodes) {
            if (node !== this.entry) {
                domin.set(node, new Set(this.nodes));
            }
        }
        let change = true;
        while (change) {
            change = false;
            for (const node of this.nodes) {
                if (node === this.entry) {
                    continue;
                }
                let t = new Set(domin.get(node));
                for (const p of node.getPred()) {
                    t = this.setIntersect(t, domin.get(p));
                }
                t.add(node);
                if (!this.isSetEqual(t, domin.get(node))) {
                    change = true;
                    domin.set(node, t);
                }
            }
        }
        return domin;
    }
    getBackEdges(dom, header) {
        var _a;
        let backEdges = new Set();
        for (const n of header.getPred()) {
            // h dom n && n -> h
            if ((_a = dom.get(n)) === null || _a === void 0 ? void 0 : _a.has(header)) {
                backEdges.add(n);
            }
        }
        return backEdges;
    }
    naturalLoop(backEdgeStart, backEdgeEnd) {
        let stack = [];
        let loop = new Set([backEdgeEnd, backEdgeStart]);
        stack.push(backEdgeStart);
        while (stack.length > 0) {
            let m = stack.shift();
            for (const pred of m.getPred()) {
                if (loop.has(pred)) {
                    continue;
                }
                loop.add(pred);
                stack.push(pred);
            }
        }
        return loop;
    }
    isSelfLoopNode(node) {
        let inSucc = false;
        let inPred = false;
        for (const pred of node.getPred()) {
            if (pred === node) {
                inPred = true;
            }
        }
        for (const succ of node.getSucc()) {
            if (succ === node) {
                inSucc = true;
            }
        }
        return inSucc && inPred;
    }
    isForLoopIncNode(node) {
        for (const loop of this.loopMap.values()) {
            if (loop.getType() === RegionType.FOR_LOOP_REGION) {
                if (node === loop.inc) {
                    return true;
                }
            }
        }
        return false;
    }
    isValidInBlocks(node, scope) {
        if (this.isForLoopIncNode(node) || node.hasIfStmt()) {
            return false;
        }
        if (scope && !scope.has(node)) {
            return false;
        }
        return true;
    }
    isIfRegion(node, nodeSet) {
        nodeSet.clear();
        if (node.getSucc().length !== 2) {
            return false;
        }
        let m = node.getSucc()[0];
        let n = node.getSucc()[1];
        if (m.getSucc().length === 1 && m.getSucc()[0] === n) {
            nodeSet.add(node).add(m);
            return true;
        }
        return false;
    }
    isIfExitRegion(node, nodeSet) {
        nodeSet.clear();
        if (node.getSucc().length !== 2) {
            return false;
        }
        let m = node.getSucc()[0];
        if (m.hasReturnStmt()) {
            nodeSet.add(node).add(m);
            return true;
        }
        return false;
    }
    isIfElseRegion(node, nodeSet) {
        nodeSet.clear();
        if (node.getSucc().length !== 2) {
            return false;
        }
        let m = node.getSucc()[0];
        let n = node.getSucc()[1];
        if ((m.getSucc().length === 1 &&
            n.getSucc().length === 1 &&
            m.getPred().length === 1 &&
            n.getPred().length === 1 &&
            m.getSucc()[0] === n.getSucc()[0]) ||
            (m.getSucc().length === 0 && n.getSucc().length === 0)) {
            nodeSet.add(node).add(m).add(n);
            return true;
        }
        return false;
    }
    isBlockRegion(node, nodeSet, scope) {
        let n = node;
        let p = true;
        let s = n.getSucc().length === 1;
        nodeSet.clear();
        let blocks = [];
        while (p && s && !nodeSet.has(n) && this.isValidInBlocks(n, scope)) {
            nodeSet.add(n);
            blocks.push(n);
            n = n.getSucc()[0];
            p = n.getPred().length === 1;
            s = n.getSucc().length === 1;
        }
        if (p && this.isValidInBlocks(n, scope)) {
            if (!nodeSet.has(n)) {
                blocks.push(n);
            }
            nodeSet.add(n);
        }
        n = node;
        p = n.getPred().length === 1;
        s = true;
        while (p && s && this.isValidInBlocks(n, scope)) {
            if (!nodeSet.has(n)) {
                blocks.unshift(n);
            }
            nodeSet.add(n);
            n = n.getPred()[0];
            if (nodeSet.has(n)) {
                break;
            }
            p = n.getPred().length === 1;
            s = n.getSucc().length === 1;
        }
        if (s && this.isValidInBlocks(n, scope)) {
            if (!nodeSet.has(n)) {
                blocks.unshift(n);
            }
            nodeSet.add(n);
        }
        nodeSet.clear();
        for (const n of blocks) {
            nodeSet.add(n);
        }
        if (nodeSet.size >= 2) {
            return true;
        }
        return false;
    }
    isIfBreakRegion(node, nodeSet, loop) {
        let m = node.getSucc()[0];
        nodeSet.clear();
        if (this.isExitLoop(m, this.structBlocks.get(loop)) && !m.hasReturnStmt()) {
            nodeSet.add(node);
            return true;
        }
        if (m.getSucc().length === 1 && this.isExitLoop(m.getSucc()[0], this.structBlocks.get(loop)) && !m.hasReturnStmt()) {
            nodeSet.add(node).add(m);
            return true;
        }
        return false;
    }
    isIfContinueRegion(node, nodeSet, loop) {
        nodeSet.clear();
        let m = node.getSucc()[0];
        let n = node.getSucc()[1];
        if (loop.control.has(m)) {
            nodeSet.add(node);
            return true;
        }
        if (m.getSucc().length === 1 && loop.control.has(m.getSucc()[0]) && !loop.control.has(n) && !this.isIfElseRegion(node, nodeSet)) {
            nodeSet.add(node).add(m);
            return true;
        }
        return false;
    }
    isWhileRegion(node, nodeSet, loop) {
        nodeSet.clear();
        let m = node.getSucc()[0];
        if (loop.header === node && m.getSucc().length === 1 && m.getPred().length === 1 && m.getSucc()[0] === node) {
            nodeSet.add(node).add(m);
            return true;
        }
        return false;
    }
    isForRegion(node, nodeSet, loop) {
        nodeSet.clear();
        if (loop.header === node && loop.getType() === RegionType.FOR_LOOP_REGION) {
            let forLoop = loop;
            let blocks = node.getSucc()[0];
            if (forLoop.inc.getPred().length === 1 && forLoop.inc.getPred()[0] === blocks && blocks.getSucc().length === 1) {
                nodeSet.add(node).add(forLoop.inc).add(blocks);
                return true;
            }
        }
        return false;
    }
    isDoWhileRegion(node, nodeSet, loop) {
        nodeSet.clear();
        if (loop.back === node && loop.getType() === RegionType.DO_WHILE_LOOP_REGION) {
            let blocks = node.getPred()[0];
            if (blocks.getSucc().length === 1 && blocks.getSucc()[0] === node && node.getSucc()[0] === blocks) {
                nodeSet.add(blocks).add(node);
                return true;
            }
        }
        return false;
    }
    identifyRegionType(node, nodeSet, scope) {
        if (this.isBlockRegion(node, nodeSet, scope)) {
            return RegionType.BLOCK_REGION;
        }
        let inLoop = false;
        let region = this.structOf.get(node);
        if (region && LOOP_TYPES.has(region === null || region === void 0 ? void 0 : region.getType())) {
            inLoop = true;
        }
        if (new Set(node.getPred()).has(node) && new Set(node.getSucc()).has(node)) {
            nodeSet.add(node);
            if (inLoop) {
                return region === null || region === void 0 ? void 0 : region.getType();
            }
            return RegionType.SELF_LOOP_REGION;
        }
        if (node.getSucc().length !== 2) {
            return undefined;
        }
        if (inLoop) {
            let loop = region;
            if (!loop.control.has(node)) {
                if (this.isIfBreakRegion(node, nodeSet, loop)) {
                    return RegionType.IF_THEN_BREAK_REGION;
                }
                if (this.isIfContinueRegion(node, nodeSet, loop)) {
                    return RegionType.IF_THEN_CONTINUE_REGION;
                }
            }
            if (this.isWhileRegion(node, nodeSet, loop)) {
                return RegionType.WHILE_LOOP_REGION;
            }
            if (this.isForRegion(node, nodeSet, loop)) {
                return RegionType.FOR_LOOP_REGION;
            }
            if (this.isDoWhileRegion(node, nodeSet, loop)) {
                return RegionType.DO_WHILE_LOOP_REGION;
            }
        }
        // check for if
        if (this.isIfExitRegion(node, nodeSet)) {
            return RegionType.IF_THEN_EXIT_REGION;
        }
        if (this.isIfRegion(node, nodeSet)) {
            return RegionType.IF_REGION;
        }
        // check for an if else
        if (this.isIfElseRegion(node, nodeSet)) {
            return RegionType.IF_ELSE_REGION;
        }
        return undefined;
    }
    cyclicRegionType(nodeSet) {
        var _a, _b, _c;
        let nodes = Array.from(nodeSet);
        let header = nodes[0];
        if (nodeSet.size === 1) {
            let tail = (_a = nodes[0].getBlock()) === null || _a === void 0 ? void 0 : _a.getTail();
            if (tail instanceof Stmt_1.ArkIfStmt) {
                return RegionType.DO_WHILE_LOOP_REGION;
            }
            return RegionType.WHILE_LOOP_REGION;
        }
        let back = nodes[1];
        // exit loop from back
        if (!this.hasExitLoopSucc(header, nodeSet) && this.hasExitLoopSucc(back, nodeSet)) {
            return RegionType.DO_WHILE_LOOP_REGION;
        }
        if (this.hasExitLoopSucc(header, nodeSet) && this.hasExitLoopSucc(back, nodeSet)) {
            // header true exit loop --> exit is break
            if (!nodeSet.has(header.getSucc()[0])) {
                return RegionType.DO_WHILE_LOOP_REGION;
            }
        }
        // for
        if (back.getSucc().length === 1 && ((_c = (_b = back.getBlock()) === null || _b === void 0 ? void 0 : _b.getStmts()) === null || _c === void 0 ? void 0 : _c.length) === 1) {
            let isForLoop = true;
            for (const pred of header.getPred()) {
                if (nodeSet.has(pred) && pred !== back) {
                    isForLoop = false;
                }
            }
            if (isForLoop) {
                return RegionType.FOR_LOOP_REGION;
            }
        }
        return RegionType.WHILE_LOOP_REGION;
    }
    hasExitLoopSucc(node, nodeSet) {
        for (const succ of node.getSucc()) {
            if (!nodeSet.has(succ)) {
                return true;
            }
        }
        return false;
    }
    isExitLoop(node, nodeSet) {
        if (this.structBlocks.has(node)) {
            for (const n of this.structBlocks.get(node)) {
                if (!nodeSet.has(n)) {
                    return true;
                }
            }
        }
        else {
            if (!nodeSet.has(node)) {
                return true;
            }
        }
        return false;
    }
    createRegion(rtype, nodeSet) {
        let node;
        if (rtype === RegionType.BLOCK_REGION) {
            node = new BlockRegion(nodeSet);
        }
        else if (rtype === RegionType.IF_ELSE_REGION) {
            node = new IfElseRegion(nodeSet);
        }
        else if (rtype === RegionType.IF_REGION) {
            node = new IfRegion(nodeSet);
        }
        else if (rtype === RegionType.IF_THEN_EXIT_REGION) {
            node = new IfExitRegion(nodeSet);
        }
        else if (rtype === RegionType.IF_THEN_BREAK_REGION) {
            node = new IfBreakRegion(nodeSet);
        }
        else if (rtype === RegionType.IF_THEN_CONTINUE_REGION) {
            node = new IfContinueRegion(nodeSet);
        }
        else if (rtype === RegionType.SELF_LOOP_REGION) {
            node = new SelfLoopRegion(nodeSet);
        }
        else if (rtype === RegionType.WHILE_LOOP_REGION) {
            let whileLoop = new WhileLoopRegion(nodeSet);
            this.loopMap.set(whileLoop.header, whileLoop);
            node = whileLoop;
        }
        else if (rtype === RegionType.FOR_LOOP_REGION) {
            let forLoop = new ForLoopRegion(nodeSet);
            this.loopMap.set(forLoop.header, forLoop);
            node = forLoop;
        }
        else if (rtype === RegionType.DO_WHILE_LOOP_REGION) {
            let doWhileLoop = new DoWhileLoopRegion(nodeSet);
            this.loopMap.set(doWhileLoop.header, doWhileLoop);
            node = doWhileLoop;
        }
        else if (rtype === RegionType.TRY_CATCH_REGION || rtype === RegionType.TRY_FINALLY_REGION || rtype === RegionType.TRY_CATCH_FINALLY_REGION) {
            node = new TrapRegion(nodeSet, rtype);
        }
        return node;
    }
    reduce(rtype, nodeSet) {
        let region = this.createRegion(rtype, nodeSet);
        region === null || region === void 0 ? void 0 : region.replace();
        if (region === undefined) {
            return undefined;
        }
        this.structTypes.set(region, rtype);
        let blocks = new Set();
        for (const s of nodeSet) {
            this.structOf.set(s, region);
            if (this.structBlocks.has(s)) {
                for (const b of this.structBlocks.get(s)) {
                    blocks.add(b);
                }
            }
            else {
                blocks.add(s);
            }
        }
        this.structBlocks.set(region, blocks);
        return region;
    }
    setIntersect(a, b) {
        let r = new Set();
        if (!b) {
            return r;
        }
        for (const n of b) {
            if (a.has(n)) {
                r.add(n);
            }
        }
        return r;
    }
    isSetEqual(a, b) {
        if (a.size !== b.size) {
            return false;
        }
        return this.setIntersect(a, b).size === a.size;
    }
    buildTrap(traps) {
        if (!traps) {
            return [];
        }
        traps.sort((a, b) => a.getTryBlocks().length + a.getCatchBlocks().length - (b.getTryBlocks().length + b.getCatchBlocks().length));
        let trapRegions = [];
        for (const trap of traps) {
            let region = new NaturalTrapRegion(trap, this.block2NodeMap);
            let findTrapRegion = this.getNaturalTrapRegion(region);
            if (!findTrapRegion) {
                for (const n of region.getNodes()) {
                    this.structOf.set(n, region);
                }
                trapRegions.push(region);
                continue;
            }
            if (findTrapRegion.type === RegionType.TRY_FINALLY_REGION) {
                findTrapRegion.trySet = region.trySet;
                findTrapRegion.catchSet = region.catchSet;
                region = findTrapRegion;
            }
            else {
                findTrapRegion.finallySet = region.finallySet;
                region = findTrapRegion;
            }
            for (const n of region.getNodes()) {
                this.structOf.set(n, region);
            }
            region.type = RegionType.TRY_CATCH_FINALLY_REGION;
        }
        this.structOf.clear();
        return trapRegions;
    }
    searchTrapFinallyNodes(trapRegions) {
        // search finally
        for (const region of trapRegions) {
            if (region.type === RegionType.TRY_CATCH_REGION) {
                continue;
            }
            this.bfs(region);
        }
    }
    bfs(region) {
        let finallyNodes = new Set();
        let count = region.finallySet.size;
        let queue = [region.getSucc()[0]];
        while (queue.length > 0 && finallyNodes.size < count) {
            let node = queue[0];
            queue.splice(0, 1);
            finallyNodes.add(node);
            region.identifyFinallySet.add(node);
            for (const succ of node.getSucc()) {
                if (!finallyNodes.has(succ)) {
                    queue.push(succ);
                }
            }
        }
    }
    getNaturalTrapRegion(trap) {
        let findTrap = this.findNaturalTrapRegion(trap.trySet);
        if (findTrap) {
            return findTrap;
        }
        if (trap.catchSet) {
            findTrap = this.findNaturalTrapRegion(trap.catchSet);
        }
        if (findTrap) {
            return findTrap;
        }
        if (trap.finallySet) {
            findTrap = this.findNaturalTrapRegion(trap.finallySet);
        }
        return findTrap;
    }
    findNaturalTrapRegion(nodes) {
        let findTrap;
        for (const node of nodes) {
            if (!this.structOf.has(node)) {
                return undefined;
            }
            if (!findTrap) {
                findTrap = this.structOf.get(node);
                continue;
            }
            if (findTrap !== this.structOf.get(node)) {
                return undefined;
            }
        }
        return findTrap;
    }
    trapsStructuralAnalysis(trapRegions) {
        trapRegions.sort((a, b) => a.size() - b.size());
        for (const trap of trapRegions) {
            let tryNode = this.trapsSubStructuralAnalysis(trap.trySet);
            let catchNode = this.trapsSubStructuralAnalysis(trap.catchSet);
            let finnallyNode = this.trapsSubStructuralAnalysis(trap.identifyFinallySet);
            if (catchNode === undefined) {
                this.reduce(RegionType.TRY_FINALLY_REGION, new Set([tryNode, finnallyNode]));
            }
            else if (finnallyNode === undefined) {
                this.reduce(RegionType.TRY_CATCH_REGION, new Set([tryNode, catchNode]));
            }
            else {
                this.reduce(RegionType.TRY_CATCH_FINALLY_REGION, new Set([tryNode, catchNode, finnallyNode]));
            }
        }
    }
    trapsSubStructuralAnalysis(nodes) {
        if (!nodes) {
            return undefined;
        }
        let entry = Array.from(nodes)[0];
        if (nodes.size <= 1) {
            return entry;
        }
        for (const node of nodes) {
            if (this.structOf.has(node)) {
                nodes.add(this.structOf.get(node));
            }
        }
        return this.structuralAnalysis(entry, nodes);
    }
}
exports.AbstractFlowGraph = AbstractFlowGraph;
var RegionType;
(function (RegionType) {
    RegionType[RegionType["ABSTRACT_NODE"] = 0] = "ABSTRACT_NODE";
    RegionType[RegionType["TRY_NODE"] = 1] = "TRY_NODE";
    RegionType[RegionType["CATCH_NODE"] = 2] = "CATCH_NODE";
    RegionType[RegionType["FINALLY_NODE"] = 3] = "FINALLY_NODE";
    /* Sequence of blocks.  */
    RegionType[RegionType["BLOCK_REGION"] = 4] = "BLOCK_REGION";
    RegionType[RegionType["IF_REGION"] = 5] = "IF_REGION";
    RegionType[RegionType["IF_ELSE_REGION"] = 6] = "IF_ELSE_REGION";
    RegionType[RegionType["IF_THEN_EXIT_REGION"] = 7] = "IF_THEN_EXIT_REGION";
    RegionType[RegionType["IF_THEN_BREAK_REGION"] = 8] = "IF_THEN_BREAK_REGION";
    RegionType[RegionType["IF_THEN_CONTINUE_REGION"] = 9] = "IF_THEN_CONTINUE_REGION";
    RegionType[RegionType["SELF_LOOP_REGION"] = 10] = "SELF_LOOP_REGION";
    RegionType[RegionType["NATURAL_LOOP_REGION"] = 11] = "NATURAL_LOOP_REGION";
    RegionType[RegionType["WHILE_LOOP_REGION"] = 12] = "WHILE_LOOP_REGION";
    RegionType[RegionType["DO_WHILE_LOOP_REGION"] = 13] = "DO_WHILE_LOOP_REGION";
    RegionType[RegionType["FOR_LOOP_REGION"] = 14] = "FOR_LOOP_REGION";
    RegionType[RegionType["CASE_REGION"] = 15] = "CASE_REGION";
    RegionType[RegionType["SWITCH_REGION"] = 16] = "SWITCH_REGION";
    RegionType[RegionType["TRY_CATCH_REGION"] = 17] = "TRY_CATCH_REGION";
    RegionType[RegionType["TRY_FINALLY_REGION"] = 18] = "TRY_FINALLY_REGION";
    RegionType[RegionType["TRY_CATCH_FINALLY_REGION"] = 19] = "TRY_CATCH_FINALLY_REGION";
})(RegionType || (RegionType = {}));
const LOOP_TYPES = new Set([
    RegionType.SELF_LOOP_REGION,
    RegionType.NATURAL_LOOP_REGION,
    RegionType.WHILE_LOOP_REGION,
    RegionType.FOR_LOOP_REGION,
    RegionType.DO_WHILE_LOOP_REGION,
]);
class AbstractNode {
    constructor() {
        this.predNodes = [];
        this.succNodes = [];
        this.type = RegionType.ABSTRACT_NODE;
    }
    traversal(callback, type) {
        callback(this.bb, type);
    }
    getType() {
        return this.type;
    }
    getSucc() {
        return this.succNodes;
    }
    addSucc(node) {
        this.succNodes.push(node);
    }
    replaceSucc(src, dst) {
        for (let i = 0; i < this.succNodes.length; i++) {
            if (this.succNodes[i] === src) {
                this.succNodes[i] = dst;
                break;
            }
        }
    }
    removeSucc(src) {
        for (let i = 0; i < this.predNodes.length; i++) {
            if (this.succNodes[i] === src) {
                this.succNodes.splice(i, 1);
                break;
            }
        }
    }
    getPred() {
        return this.predNodes;
    }
    addPred(block) {
        let set = new Set(this.predNodes);
        if (set.has(block)) {
            return;
        }
        this.predNodes.push(block);
    }
    replacePred(src, dst) {
        for (let i = 0; i < this.predNodes.length; i++) {
            if (this.predNodes[i] === src) {
                this.predNodes[i] = dst;
                break;
            }
        }
    }
    removePred(src) {
        for (let i = 0; i < this.predNodes.length; i++) {
            if (this.predNodes[i] === src) {
                this.predNodes.splice(i, 1);
                break;
            }
        }
    }
    setBlock(bb) {
        this.bb = bb;
    }
    getBlock() {
        return this.bb;
    }
    hasIfStmt() {
        if (!this.bb) {
            return false;
        }
        for (let stmt of this.bb.getStmts()) {
            if (stmt instanceof Stmt_1.ArkIfStmt) {
                return true;
            }
        }
        return false;
    }
    hasReturnStmt() {
        if (!this.bb) {
            return false;
        }
        for (let stmt of this.bb.getStmts()) {
            if (stmt instanceof Stmt_1.ArkReturnStmt) {
                return true;
            }
        }
        return false;
    }
}
class Region extends AbstractNode {
    constructor(nset, type) {
        super();
        this.nset = nset;
        this.type = type;
    }
    getBlock() {
        if (this.nset.size === 0) {
            return undefined;
        }
        return Array.from(this.nset)[0].getBlock();
    }
}
class BlockRegion extends Region {
    constructor(nset) {
        super(nset, RegionType.BLOCK_REGION);
        this.blocks = Array.from(nset);
    }
    replace() {
        for (let pred of this.blocks[0].getPred()) {
            pred.replaceSucc(this.blocks[0], this);
            this.addPred(pred);
        }
        for (let succ of this.blocks[this.blocks.length - 1].getSucc()) {
            succ.replacePred(this.blocks[this.blocks.length - 1], this);
            this.addSucc(succ);
        }
    }
    traversal(callback) {
        for (const node of this.blocks) {
            node.traversal(callback, CodeBlockType.NORMAL);
        }
    }
}
class NaturalLoopRegion extends Region {
    constructor(nset, type = RegionType.NATURAL_LOOP_REGION) {
        super(nset, type);
        let nodes = Array.from(nset);
        this.header = nodes[0];
        if (nset.size > 1) {
            this.back = nodes[1];
        }
        else {
            this.back = nodes[0];
        }
        this.control = new Set([this.header]);
    }
    replace() {
        for (let pred of this.header.getPred()) {
            if (!this.nset.has(pred)) {
                pred.replaceSucc(this.header, this);
                this.addPred(pred);
            }
        }
        let succNodes = new Set();
        for (let node of this.nset) {
            for (let succ of node.getSucc()) {
                if (!this.nset.has(succ)) {
                    succNodes.add(succ);
                }
            }
        }
        if (succNodes.size === 0) {
            return;
        }
        let pred = Array.from(succNodes)[0];
        let replaced = false;
        for (let succ of pred.getPred()) {
            if (this.nset.has(succ)) {
                if (!replaced) {
                    pred.replacePred(succ, this);
                    this.addSucc(pred);
                    replaced = true;
                }
                else {
                    pred.removePred(succ);
                }
            }
        }
    }
    revise() {
        // add node to loop sets
        for (const node of this.nset) {
            for (const succ of node.getSucc()) {
                if (!this.nset.has(succ) && succ !== this.getExitNode() && succ.getSucc().length === 1 && succ.getSucc()[0] === this.getExitNode()) {
                    this.nset.add(succ);
                }
            }
        }
    }
}
class SelfLoopRegion extends NaturalLoopRegion {
    constructor(nset) {
        super(nset, RegionType.SELF_LOOP_REGION);
        this.back = this.header;
    }
    replace() {
        for (let pred of this.header.getPred()) {
            if (pred !== this.header) {
                pred.replaceSucc(this.header, this);
                this.addPred(pred);
            }
        }
        for (let succ of this.header.getSucc()) {
            if (succ !== this.header) {
                succ.replacePred(this.header, this);
                this.addSucc(succ);
            }
        }
    }
    getExitNode() {
        return this.header.getSucc()[1];
    }
}
class WhileLoopRegion extends NaturalLoopRegion {
    constructor(nset) {
        super(nset, RegionType.WHILE_LOOP_REGION);
    }
    traversal(callback) {
        this.header.traversal(callback, CodeBlockType.WHILE);
        if (this.header !== this.back) {
            this.back.traversal(callback, CodeBlockType.NORMAL);
        }
        callback(undefined, CodeBlockType.COMPOUND_END);
    }
    getExitNode() {
        return this.header.getSucc()[1];
    }
}
class DoWhileLoopRegion extends NaturalLoopRegion {
    constructor(nset) {
        super(nset, RegionType.DO_WHILE_LOOP_REGION);
        this.control.clear();
        this.control.add(this.back);
    }
    traversal(callback) {
        callback(undefined, CodeBlockType.DO);
        if (this.header !== this.back) {
            this.header.traversal(callback, CodeBlockType.NORMAL);
        }
        this.back.traversal(callback, CodeBlockType.DO_WHILE);
    }
    getExitNode() {
        return this.back.getSucc()[1];
    }
}
class ForLoopRegion extends NaturalLoopRegion {
    constructor(nset) {
        super(nset, RegionType.FOR_LOOP_REGION);
        this.inc = this.back;
        this.control.add(this.inc);
    }
    traversal(callback) {
        this.header.traversal(callback, CodeBlockType.FOR);
        for (const node of this.nset) {
            if (node !== this.header && node !== this.inc) {
                node.traversal(callback, CodeBlockType.NORMAL);
            }
        }
        callback(undefined, CodeBlockType.COMPOUND_END);
    }
    getExitNode() {
        return this.header.getSucc()[1];
    }
}
class IfRegion extends Region {
    constructor(nset) {
        super(nset, RegionType.IF_REGION);
        let nodes = Array.from(nset);
        this.contition = nodes[0];
        this.then = nodes[1];
    }
    replace() {
        this.replaceContitionPred();
        for (let succ of this.then.getSucc()) {
            if (succ !== this.then) {
                succ.replacePred(this.then, this);
                succ.removePred(this.contition);
                this.addSucc(succ);
            }
        }
    }
    traversal(callback) {
        this.contition.traversal(callback, CodeBlockType.IF);
        this.then.traversal(callback, CodeBlockType.NORMAL);
        callback(undefined, CodeBlockType.COMPOUND_END);
    }
    replaceContitionPred() {
        for (let pred of this.contition.getPred()) {
            if (pred !== this.contition) {
                pred.replaceSucc(this.contition, this);
                this.addPred(pred);
            }
        }
    }
}
class IfExitRegion extends IfRegion {
    constructor(nset) {
        super(nset);
        this.type = RegionType.IF_THEN_EXIT_REGION;
    }
    replace() {
        this.replaceContitionPred();
        let succ = this.contition.getSucc()[1];
        succ.replacePred(this.contition, this);
        this.addSucc(succ);
    }
}
class IfBreakRegion extends IfRegion {
    constructor(nset) {
        super(nset);
        this.type = RegionType.IF_THEN_BREAK_REGION;
    }
    replace() {
        this.replaceContitionPred();
        let succ = this.contition.getSucc()[1];
        succ.replacePred(this.contition, this);
        this.addSucc(succ);
        if (this.then) {
            succ = this.then.getSucc()[0];
            succ.removePred(this.then);
        }
        else {
            succ = this.contition.getSucc()[0];
            succ.removePred(this.contition);
        }
    }
    traversal(callback) {
        var _a;
        this.contition.traversal(callback, CodeBlockType.IF);
        (_a = this.then) === null || _a === void 0 ? void 0 : _a.traversal(callback, CodeBlockType.NORMAL);
        callback(undefined, CodeBlockType.BREAK);
        callback(undefined, CodeBlockType.COMPOUND_END);
    }
}
class IfContinueRegion extends IfBreakRegion {
    constructor(nset) {
        super(nset);
        this.type = RegionType.IF_THEN_CONTINUE_REGION;
    }
    traversal(callback) {
        var _a;
        this.contition.traversal(callback, CodeBlockType.IF);
        (_a = this.then) === null || _a === void 0 ? void 0 : _a.traversal(callback, CodeBlockType.NORMAL);
        callback(undefined, CodeBlockType.CONTINUE);
        callback(undefined, CodeBlockType.COMPOUND_END);
    }
}
class IfElseRegion extends Region {
    constructor(nset) {
        super(nset, RegionType.IF_ELSE_REGION);
        let nodes = Array.from(nset);
        this.contition = nodes[0];
        this.then = nodes[1];
        this.else = nodes[2];
    }
    replace() {
        for (let pred of this.contition.getPred()) {
            if (pred !== this.contition) {
                pred.replaceSucc(this.contition, this);
                this.addPred(pred);
            }
        }
        for (let succ of this.then.getSucc()) {
            if (succ !== this.then) {
                succ.replacePred(this.then, this);
                succ.removePred(this.else);
                this.addSucc(succ);
            }
        }
    }
    traversal(callback) {
        this.contition.traversal(callback, CodeBlockType.IF);
        this.then.traversal(callback, CodeBlockType.NORMAL);
        callback(undefined, CodeBlockType.ELSE);
        this.else.traversal(callback, CodeBlockType.NORMAL);
        callback(undefined, CodeBlockType.COMPOUND_END);
    }
}
class TrapRegion extends Region {
    constructor(nset, type) {
        super(nset, type);
        let nodes = Array.from(nset);
        this.tryNode = nodes[0];
        if (type === RegionType.TRY_CATCH_REGION) {
            this.catchNode = nodes[1];
        }
        else if (type === RegionType.TRY_FINALLY_REGION) {
            this.finallyNode = nodes[1];
        }
        else {
            this.catchNode = nodes[1];
            this.finallyNode = nodes[2];
        }
    }
    replace() {
        for (let pred of this.tryNode.getPred()) {
            if (pred !== this.tryNode) {
                pred.replaceSucc(this.tryNode, this);
                this.addPred(pred);
            }
        }
        if (this.finallyNode) {
            for (let succ of this.finallyNode.getSucc()) {
                if (succ !== this.finallyNode) {
                    succ.replacePred(this.finallyNode, this);
                    this.addSucc(succ);
                }
            }
        }
        else {
            for (let succ of this.tryNode.getSucc()) {
                if (succ !== this.tryNode) {
                    succ.replacePred(this.tryNode, this);
                    this.addSucc(succ);
                }
            }
        }
    }
    traversal(callback) {
        var _a, _b;
        callback(undefined, CodeBlockType.TRY);
        this.tryNode.traversal(callback, CodeBlockType.NORMAL);
        if (this.catchNode) {
            callback(this.catchNode.getBlock(), CodeBlockType.CATCH);
            (_a = this.catchNode) === null || _a === void 0 ? void 0 : _a.traversal(callback, CodeBlockType.NORMAL);
        }
        if (this.finallyNode) {
            callback(undefined, CodeBlockType.FINALLY);
            (_b = this.finallyNode) === null || _b === void 0 ? void 0 : _b.traversal(callback, CodeBlockType.NORMAL);
        }
        callback(undefined, CodeBlockType.COMPOUND_END);
    }
}
class NaturalTrapRegion extends Region {
    constructor(trap, block2NodeMap) {
        super(new Set(), RegionType.TRY_CATCH_FINALLY_REGION);
        this.trySet = new Set();
        this.catchSet = new Set();
        this.identifyFinallySet = new Set();
        for (const block of trap.getTryBlocks()) {
            this.trySet.add(block2NodeMap.get(block));
        }
        for (const block of trap.getCatchBlocks()) {
            this.catchSet.add(block2NodeMap.get(block));
        }
        if (this.isFinallyNode(Array.from(this.catchSet)[this.catchSet.size - 1])) {
            this.type = RegionType.TRY_FINALLY_REGION;
            this.finallySet = this.catchSet;
            this.catchSet = undefined;
        }
        else {
            this.type = RegionType.TRY_CATCH_REGION;
        }
    }
    isFinallyNode(node) {
        let block = node.getBlock();
        if (!block) {
            return false;
        }
        let stmtLen = block.getStmts().length;
        if (stmtLen < 1) {
            return false;
        }
        let stmtLast = block.getStmts()[stmtLen - 1];
        return stmtLast instanceof Stmt_1.ArkThrowStmt;
    }
    size() {
        let size = this.trySet.size;
        if (this.catchSet) {
            size += this.catchSet.size;
        }
        if (this.finallySet) {
            size += this.finallySet.size;
        }
        return size;
    }
    replace() { }
    getNodes() {
        let nodes = Array.from(this.trySet);
        if (this.catchSet) {
            nodes.push(...this.catchSet);
        }
        if (this.finallySet) {
            nodes.push(...this.finallySet);
        }
        return nodes;
    }
    getSucc() {
        let succ = new Set();
        for (const node of this.trySet) {
            for (const s of node.getSucc()) {
                if (!this.trySet.has(s)) {
                    succ.add(s);
                }
            }
        }
        return Array.from(succ);
    }
}
