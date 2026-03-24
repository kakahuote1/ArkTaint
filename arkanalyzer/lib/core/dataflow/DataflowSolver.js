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
exports.DataflowSolver = void 0;
const Expr_1 = require("../base/Expr");
const Stmt_1 = require("../base/Stmt");
const Edge_1 = require("./Edge");
const CallGraph_1 = require("../../callgraph/model/CallGraph");
const ClassHierarchyAnalysis_1 = require("../../callgraph/algorithm/ClassHierarchyAnalysis");
const entryMethodUtils_1 = require("../../utils/entryMethodUtils");
const Util_1 = require("./Util");
const CallGraphBuilder_1 = require("../../callgraph/model/builder/CallGraphBuilder");
class DataflowSolver {
    constructor(problem, scene) {
        this.laterEdges = new Set();
        this.problem = problem;
        this.scene = scene;
        scene.inferTypes();
        this.zeroFact = problem.createZeroValue();
        this.workList = new Array();
        this.pathEdgeSet = new Set();
        this.inComing = new Map();
        this.endSummary = new Map();
        this.summaryEdge = new Set();
        this.stmtNexts = new Map();
    }
    solve() {
        this.init();
        this.doSolve();
    }
    computeResult(stmt, d) {
        for (let pathEdge of this.pathEdgeSet) {
            if (pathEdge.edgeEnd.node === stmt && pathEdge.edgeEnd.fact === d) {
                return true;
            }
        }
        return false;
    }
    getChildren(stmt) {
        return Array.from(this.stmtNexts.get(stmt) || []);
    }
    init() {
        let edgePoint = new Edge_1.PathEdgePoint(this.problem.getEntryPoint(), this.zeroFact);
        let edge = new Edge_1.PathEdge(edgePoint, edgePoint);
        this.workList.push(edge);
        this.pathEdgeSet.add(edge);
        // build CHA
        let cg = new CallGraph_1.CallGraph(this.scene);
        this.CHA = new ClassHierarchyAnalysis_1.ClassHierarchyAnalysis(this.scene, cg, new CallGraphBuilder_1.CallGraphBuilder(cg, this.scene));
        this.buildStmtMapInClass();
        this.setCfg4AllStmt();
        return;
    }
    buildStmtMapInClass() {
        const methods = this.scene.getMethods();
        methods.push(this.problem.getEntryMethod());
        for (const method of methods) {
            const cfg = method.getCfg();
            const blocks = [];
            if (cfg) {
                blocks.push(...cfg.getBlocks());
            }
            for (const block of blocks) {
                this.buildStmtMapInBlock(block);
            }
        }
    }
    buildStmtMapInBlock(block) {
        const stmts = block.getStmts();
        for (let stmtIndex = 0; stmtIndex < stmts.length; stmtIndex++) {
            const stmt = stmts[stmtIndex];
            if (stmtIndex !== stmts.length - 1) {
                this.stmtNexts.set(stmt, new Set([stmts[stmtIndex + 1]]));
            }
            else {
                const set = new Set();
                for (const successor of block.getSuccessors()) {
                    set.add(successor.getHead());
                }
                this.stmtNexts.set(stmt, set);
            }
        }
    }
    setCfg4AllStmt() {
        for (const cls of this.scene.getClasses()) {
            for (const mtd of cls.getMethods(true)) {
                (0, entryMethodUtils_1.addCfg2Stmt)(mtd);
            }
        }
    }
    getAllCalleeMethods(callNode) {
        const callSites = this.CHA.resolveCall(this.CHA.getCallGraph().getCallGraphNodeByMethod(this.problem.getEntryMethod().getSignature()).getID(), callNode);
        const methods = new Set();
        for (const callSite of callSites) {
            const method = this.scene.getMethod(this.CHA.getCallGraph().getMethodByFuncID(callSite.calleeFuncID));
            if (method) {
                methods.add(method);
            }
        }
        return methods;
    }
    getReturnSiteOfCall(call) {
        return [...this.stmtNexts.get(call)][0];
    }
    getStartOfCallerMethod(call) {
        const cfg = call.getCfg();
        const paraNum = cfg.getDeclaringMethod().getParameters().length;
        return cfg.getStartingBlock().getStmts()[paraNum];
    }
    pathEdgeSetHasEdge(edge) {
        for (const path of this.pathEdgeSet) {
            this.problem.factEqual(path.edgeEnd.fact, edge.edgeEnd.fact);
            if (path.edgeEnd.node === edge.edgeEnd.node &&
                this.problem.factEqual(path.edgeEnd.fact, edge.edgeEnd.fact) &&
                path.edgeStart.node === edge.edgeStart.node &&
                this.problem.factEqual(path.edgeStart.fact, edge.edgeStart.fact)) {
                return true;
            }
        }
        return false;
    }
    propagate(edge) {
        if (!this.pathEdgeSetHasEdge(edge)) {
            let index = this.workList.length;
            for (let i = 0; i < this.workList.length; i++) {
                if (this.laterEdges.has(this.workList[i])) {
                    index = i;
                    break;
                }
            }
            this.workList.splice(index, 0, edge);
            this.pathEdgeSet.add(edge);
        }
    }
    processExitNode(edge) {
        var _a;
        let startEdgePoint = edge.edgeStart;
        let exitEdgePoint = edge.edgeEnd;
        const summary = this.endSummary.get(startEdgePoint);
        if (summary === undefined) {
            this.endSummary.set(startEdgePoint, new Set([exitEdgePoint]));
        }
        else {
            summary.add(exitEdgePoint);
        }
        const callEdgePoints = this.inComing.get(startEdgePoint);
        if (callEdgePoints === undefined) {
            if (startEdgePoint.node.getCfg().getDeclaringMethod() === this.problem.getEntryMethod()) {
                return;
            }
            throw new Error('incoming does not have ' + ((_a = startEdgePoint.node.getCfg()) === null || _a === void 0 ? void 0 : _a.getDeclaringMethod().toString()));
        }
        for (let callEdgePoint of callEdgePoints) {
            let returnSite = this.getReturnSiteOfCall(callEdgePoint.node);
            let returnFlowFunc = this.problem.getExitToReturnFlowFunction(exitEdgePoint.node, returnSite, callEdgePoint.node);
            this.handleFacts(returnFlowFunc, returnSite, exitEdgePoint, callEdgePoint);
        }
    }
    handleFacts(returnFlowFunc, returnSite, exitEdgePoint, callEdgePoint) {
        for (let fact of returnFlowFunc.getDataFacts(exitEdgePoint.fact)) {
            let returnSitePoint = new Edge_1.PathEdgePoint(returnSite, fact);
            let cacheEdge = new Edge_1.PathEdge(callEdgePoint, returnSitePoint);
            let summaryEdgeHasCacheEdge = false;
            for (const sEdge of this.summaryEdge) {
                if (sEdge.edgeStart === callEdgePoint && sEdge.edgeEnd.node === returnSite && sEdge.edgeEnd.fact === fact) {
                    summaryEdgeHasCacheEdge = true;
                    break;
                }
            }
            if (summaryEdgeHasCacheEdge) {
                continue;
            }
            this.summaryEdge.add(cacheEdge);
            let startOfCaller = this.getStartOfCallerMethod(callEdgePoint.node);
            for (let pathEdge of this.pathEdgeSet) {
                if (pathEdge.edgeStart.node === startOfCaller && pathEdge.edgeEnd === callEdgePoint) {
                    this.propagate(new Edge_1.PathEdge(pathEdge.edgeStart, returnSitePoint));
                }
            }
        }
    }
    processNormalNode(edge) {
        let start = edge.edgeStart;
        let end = edge.edgeEnd;
        let stmts = [...this.getChildren(end.node)].reverse();
        for (let stmt of stmts) {
            let flowFunction = this.problem.getNormalFlowFunction(end.node, stmt);
            let set = flowFunction.getDataFacts(end.fact);
            for (let fact of set) {
                let edgePoint = new Edge_1.PathEdgePoint(stmt, fact);
                const edge = new Edge_1.PathEdge(start, edgePoint);
                this.propagate(edge);
                this.laterEdges.add(edge);
            }
        }
    }
    processCallNode(edge) {
        let start = edge.edgeStart;
        let callEdgePoint = edge.edgeEnd;
        const invokeStmt = callEdgePoint.node;
        let callees;
        if (this.scene.getFile(invokeStmt.getInvokeExpr().getMethodSignature().getDeclaringClassSignature().getDeclaringFileSignature())) {
            callees = this.getAllCalleeMethods(callEdgePoint.node);
        }
        else {
            callees = new Set([(0, Util_1.getRecallMethodInParam)(invokeStmt)]);
        }
        let returnSite = this.getReturnSiteOfCall(callEdgePoint.node);
        for (let callee of callees) {
            let callFlowFunc = this.problem.getCallFlowFunction(invokeStmt, callee);
            if (!callee.getCfg()) {
                continue;
            }
            let firstStmt = callee.getCfg().getStartingBlock().getStmts()[callee.getParameters().length];
            let facts = callFlowFunc.getDataFacts(callEdgePoint.fact);
            for (let fact of facts) {
                this.callNodeFactPropagate(edge, firstStmt, fact, returnSite);
            }
        }
        let callToReturnflowFunc = this.problem.getCallToReturnFlowFunction(edge.edgeEnd.node, returnSite);
        let set = callToReturnflowFunc.getDataFacts(callEdgePoint.fact);
        for (let fact of set) {
            this.propagate(new Edge_1.PathEdge(start, new Edge_1.PathEdgePoint(returnSite, fact)));
        }
        for (let cacheEdge of this.summaryEdge) {
            if (cacheEdge.edgeStart === edge.edgeEnd && cacheEdge.edgeEnd.node === returnSite) {
                this.propagate(new Edge_1.PathEdge(start, cacheEdge.edgeEnd));
            }
        }
    }
    callNodeFactPropagate(edge, firstStmt, fact, returnSite) {
        let callEdgePoint = edge.edgeEnd;
        // method start loop path edge
        let startEdgePoint = new Edge_1.PathEdgePoint(firstStmt, fact);
        this.propagate(new Edge_1.PathEdge(startEdgePoint, startEdgePoint));
        //add callEdgePoint in inComing.get(startEdgePoint)
        let coming;
        for (const incoming of this.inComing.keys()) {
            if (incoming.fact === startEdgePoint.fact && incoming.node === startEdgePoint.node) {
                coming = this.inComing.get(incoming);
                break;
            }
        }
        if (coming === undefined) {
            this.inComing.set(startEdgePoint, new Set([callEdgePoint]));
        }
        else {
            coming.add(callEdgePoint);
        }
        let exitEdgePoints = new Set();
        for (const end of Array.from(this.endSummary.keys())) {
            if (end.fact === fact && end.node === firstStmt) {
                exitEdgePoints = this.endSummary.get(end);
            }
        }
        for (let exitEdgePoint of exitEdgePoints) {
            let returnFlowFunc = this.problem.getExitToReturnFlowFunction(exitEdgePoint.node, returnSite, callEdgePoint.node);
            for (let returnFact of returnFlowFunc.getDataFacts(exitEdgePoint.fact)) {
                this.summaryEdge.add(new Edge_1.PathEdge(edge.edgeEnd, new Edge_1.PathEdgePoint(returnSite, returnFact)));
            }
        }
    }
    doSolve() {
        while (this.workList.length !== 0) {
            let pathEdge = this.workList.shift();
            if (this.laterEdges.has(pathEdge)) {
                this.laterEdges.delete(pathEdge);
            }
            let targetStmt = pathEdge.edgeEnd.node;
            if (this.isCallStatement(targetStmt)) {
                this.processCallNode(pathEdge);
            }
            else if (this.isExitStatement(targetStmt)) {
                this.processExitNode(pathEdge);
            }
            else {
                this.processNormalNode(pathEdge);
            }
        }
    }
    isCallStatement(stmt) {
        for (const expr of stmt.getExprs()) {
            if (expr instanceof Expr_1.AbstractInvokeExpr) {
                if (this.scene.getFile(expr.getMethodSignature().getDeclaringClassSignature().getDeclaringFileSignature())) {
                    return true;
                }
                if (stmt instanceof Stmt_1.ArkInvokeStmt && (0, Util_1.getRecallMethodInParam)(stmt)) {
                    return true;
                }
            }
        }
        return false;
    }
    isExitStatement(stmt) {
        return stmt instanceof Stmt_1.ArkReturnStmt || stmt instanceof Stmt_1.ArkReturnVoidStmt;
    }
    getPathEdgeSet() {
        return this.pathEdgeSet;
    }
}
exports.DataflowSolver = DataflowSolver;
