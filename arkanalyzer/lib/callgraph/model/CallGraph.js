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
exports.CallGraph = exports.CallGraphNode = exports.CallGraphEdge = exports.CallGraphNodeKind = exports.DynCallSite = exports.CallSite = void 0;
const ArkSignature_1 = require("../../core/model/ArkSignature");
const GraphPrinter_1 = require("../../save/GraphPrinter");
const PrinterBuilder_1 = require("../../save/PrinterBuilder");
const BaseExplicitGraph_1 = require("../../core/graph/BaseExplicitGraph");
const Statistics_1 = require("../common/Statistics");
const Const_1 = require("../../core/common/Const");
const CallSite_1 = require("./CallSite");
Object.defineProperty(exports, "CallSite", { enumerable: true, get: function () { return CallSite_1.CallSite; } });
Object.defineProperty(exports, "DynCallSite", { enumerable: true, get: function () { return CallSite_1.DynCallSite; } });
var CallGraphNodeKind;
(function (CallGraphNodeKind) {
    CallGraphNodeKind[CallGraphNodeKind["real"] = 0] = "real";
    CallGraphNodeKind[CallGraphNodeKind["vitual"] = 1] = "vitual";
    CallGraphNodeKind[CallGraphNodeKind["intrinsic"] = 2] = "intrinsic";
    CallGraphNodeKind[CallGraphNodeKind["constructor"] = 3] = "constructor";
    CallGraphNodeKind[CallGraphNodeKind["blank"] = 4] = "blank";
})(CallGraphNodeKind = exports.CallGraphNodeKind || (exports.CallGraphNodeKind = {}));
class CallGraphEdge extends BaseExplicitGraph_1.BaseEdge {
    // private callSiteID: CallSiteID;
    constructor(src, dst) {
        super(src, dst, 0);
        this.directCalls = new Set();
        this.specialCalls = new Set();
        this.indirectCalls = new Set();
    }
    addDirectCallSite(stmt) {
        this.directCalls.add(stmt);
    }
    addSpecialCallSite(stmt) {
        this.specialCalls.add(stmt);
    }
    addInDirectCallSite(stmt) {
        this.indirectCalls.add(stmt);
    }
    getDotAttr() {
        const indirectCallNums = this.indirectCalls.size;
        const directCallNums = this.directCalls.size;
        const specialCallNums = this.specialCalls.size;
        if (indirectCallNums !== 0 && directCallNums === 0) {
            return 'color=red';
        }
        else if (specialCallNums !== 0) {
            return 'color=yellow';
        }
        else if (indirectCallNums === 0 && directCallNums !== 0) {
            return 'color=black';
        }
        else {
            return 'color=black';
        }
    }
}
exports.CallGraphEdge = CallGraphEdge;
class CallGraphNode extends BaseExplicitGraph_1.BaseNode {
    constructor(id, m, k = CallGraphNodeKind.real) {
        super(id, k);
        this.ifSdkMethod = false;
        this.method = m;
    }
    getMethod() {
        return this.method;
    }
    setSdkMethod(v) {
        this.ifSdkMethod = v;
    }
    isSdkMethod() {
        return this.ifSdkMethod;
    }
    get isBlankMethod() {
        return this.kind === CallGraphNodeKind.blank;
    }
    getDotAttr() {
        return 'shape=box';
    }
    getDotLabel() {
        let label = 'ID: ' + this.getID() + '\n';
        label = label + this.getMethod().toString();
        return label;
    }
}
exports.CallGraphNode = CallGraphNode;
class CallGraph extends BaseExplicitGraph_1.BaseExplicitGraph {
    constructor(s) {
        super();
        this.csManager = new CallSite_1.CallSiteManager();
        this.stmtToCallSitemap = new Map();
        this.stmtToDynCallSitemap = new Map();
        this.methodToCGNodeMap = new Map();
        this.callPairToEdgeMap = new Map();
        this.methodToCallSiteMap = new Map();
        this.scene = s;
        this.cgStat = new Statistics_1.CGStat();
    }
    getCallPairString(srcID, dstID) {
        return `${srcID}-${dstID}`;
    }
    getCallEdgeByPair(srcID, dstID) {
        let key = this.getCallPairString(srcID, dstID);
        return this.callPairToEdgeMap.get(key);
    }
    addCallGraphNode(method, kind = CallGraphNodeKind.real) {
        let id = this.nodeNum;
        let cgNode = new CallGraphNode(id, method, kind);
        // check if sdk method
        cgNode.setSdkMethod(this.scene.hasSdkFile(method.getDeclaringClassSignature().getDeclaringFileSignature()));
        this.addNode(cgNode);
        this.methodToCGNodeMap.set(method.toString(), cgNode.getID());
        this.cgStat.addNodeStat(kind);
        return cgNode;
    }
    removeCallGraphNode(nodeID) {
        // remove edge relate to node first
        this.removeCallGraphEdge(nodeID);
        let node = this.getNode(nodeID);
        // remove node itself
        this.removeNode(nodeID);
        this.methodToCGNodeMap.delete(node.getMethod().toString());
    }
    getCallGraphNodeByMethod(method) {
        if (!method) {
            throw new Error();
        }
        let n = this.methodToCGNodeMap.get(method.toString());
        if (n === undefined) {
            // The method can't be found
            // means the method has no implementation, or base type is unclear to find it
            // Create a virtual CG Node
            // TODO: this virtual CG Node need be remove once the base type is clear
            return this.addCallGraphNode(method, CallGraphNodeKind.vitual);
        }
        return this.getNode(n);
    }
    addDirectOrSpecialCallEdge(caller, callee, callStmt, isDirectCall = true) {
        var _a;
        let callerNode = this.getCallGraphNodeByMethod(caller);
        let calleeNode = this.getCallGraphNodeByMethod(callee);
        let args = (_a = callStmt.getInvokeExpr()) === null || _a === void 0 ? void 0 : _a.getArgs();
        let cs = this.csManager.newCallSite(callStmt, args, calleeNode.getID(), callerNode.getID());
        if (this.addStmtToCallSiteMap(callStmt, cs)) {
            // TODO: check stmt exists
        }
        // TODO: check if edge exists
        let callEdge = this.getCallEdgeByPair(callerNode.getID(), calleeNode.getID());
        if (callEdge === undefined) {
            callEdge = new CallGraphEdge(callerNode, calleeNode);
            callEdge.getSrcNode().addOutgoingEdge(callEdge);
            callEdge.getDstNode().addIncomingEdge(callEdge);
            this.callPairToEdgeMap.set(this.getCallPairString(callerNode.getID(), calleeNode.getID()), callEdge);
            this.edgeNum++;
        }
        if (isDirectCall) {
            callEdge.addDirectCallSite(callStmt);
        }
        else {
            callEdge.addSpecialCallSite(callStmt);
        }
    }
    removeCallGraphEdge(nodeID) {
        let node = this.getNode(nodeID);
        for (const inEdge of node.getIncomingEdge()) {
            node.removeIncomingEdge(inEdge);
        }
        for (const outEdge of node.getOutgoingEdges()) {
            node.removeIncomingEdge(outEdge);
        }
    }
    addDynamicCallInfo(callStmt, caller, protentialCallee) {
        var _a;
        let callerNode = this.getCallGraphNodeByMethod(caller);
        let calleeNode;
        if (protentialCallee) {
            calleeNode = this.getCallGraphNodeByMethod(protentialCallee);
        }
        let args = (_a = callStmt.getInvokeExpr()) === null || _a === void 0 ? void 0 : _a.getArgs();
        let cs = this.csManager.newDynCallSite(callStmt, args, calleeNode === null || calleeNode === void 0 ? void 0 : calleeNode.getID(), callerNode.getID());
        this.stmtToDynCallSitemap.set(callStmt, cs);
    }
    addDynamicCallEdge(callerID, calleeID, callStmt) {
        let callerNode = this.getNode(callerID);
        let calleeNode = this.getNode(calleeID);
        let callEdge = this.getCallEdgeByPair(callerNode.getID(), calleeNode.getID());
        if (callEdge === undefined) {
            callEdge = new CallGraphEdge(callerNode, calleeNode);
            callEdge.getSrcNode().addOutgoingEdge(callEdge);
            callEdge.getDstNode().addIncomingEdge(callEdge);
            this.callPairToEdgeMap.set(this.getCallPairString(callerNode.getID(), calleeNode.getID()), callEdge);
            this.edgeNum++;
        }
        callEdge.addInDirectCallSite(callStmt);
    }
    getDynCallSiteByStmt(stmt) {
        return this.stmtToDynCallSitemap.get(stmt);
    }
    addStmtToCallSiteMap(stmt, cs) {
        var _a;
        if (this.stmtToCallSitemap.has(stmt)) {
            let callSites = (_a = this.stmtToCallSitemap.get(stmt)) !== null && _a !== void 0 ? _a : [];
            this.stmtToCallSitemap.set(stmt, [...callSites, cs]);
            return false;
        }
        this.stmtToCallSitemap.set(stmt, [cs]);
        return true;
    }
    getCallSiteByStmt(stmt) {
        var _a;
        return (_a = this.stmtToCallSitemap.get(stmt)) !== null && _a !== void 0 ? _a : [];
    }
    addMethodToCallSiteMap(funcID, cs) {
        if (this.methodToCallSiteMap.has(funcID)) {
            this.methodToCallSiteMap.get(funcID).add(cs);
        }
        else {
            this.methodToCallSiteMap.set(funcID, new Set([cs]));
        }
    }
    getCallSitesByMethod(func) {
        var _a;
        let funcID;
        if (func instanceof ArkSignature_1.MethodSignature) {
            funcID = this.getCallGraphNodeByMethod(func).getID();
        }
        else {
            funcID = func;
        }
        return (_a = this.methodToCallSiteMap.get(funcID)) !== null && _a !== void 0 ? _a : new Set();
    }
    getInvokeStmtByMethod(func) {
        let callSites = this.getCallSitesByMethod(func);
        let invokeStmts = [];
        callSites.forEach(cs => {
            invokeStmts.push(cs.callStmt);
        });
        return invokeStmts;
    }
    getDynEdges() {
        let callMap = new Map();
        this.callPairToEdgeMap.forEach((edge) => {
            let srcMethod = edge.getSrcNode().getMethod();
            let dstMethod = edge.getDstNode().getMethod();
            let dstSet;
            if (callMap.has(srcMethod)) {
                dstSet = callMap.get(srcMethod);
            }
            else {
                dstSet = new Set();
            }
            callMap.set(srcMethod, dstSet.add(dstMethod));
        });
        return callMap;
    }
    getMethodByFuncID(id) {
        let node = this.getNode(id);
        if (node !== undefined) {
            return node.getMethod();
        }
        return null;
    }
    getArkMethodByFuncID(id) {
        let method = this.getMethodByFuncID(id);
        if (method != null) {
            // TODO: SDK Method search
            return this.scene.getMethod(method);
        }
        return null;
    }
    getEntries() {
        return this.entries;
    }
    setEntries(n) {
        this.entries = n;
    }
    dump(name, entry) {
        let printer = new GraphPrinter_1.GraphPrinter(this);
        if (entry) {
            printer.setStartID(entry);
        }
        PrinterBuilder_1.PrinterBuilder.dump(printer, name);
    }
    detectReachable(fromID, dstID) {
        let dWorklist = [];
        let travserdFuncs = new Set();
        dWorklist.push(fromID);
        while (dWorklist.length > 0) {
            let nodeID = dWorklist.shift();
            if (travserdFuncs.has(nodeID)) {
                continue;
            }
            travserdFuncs.add(nodeID);
            let node = this.getNode(nodeID);
            for (let e of node.getOutgoingEdges()) {
                let dst = e.getDstID();
                if (dst === dstID) {
                    return true;
                }
                dWorklist.push(dst);
            }
        }
        return false;
    }
    startStat() {
        this.cgStat.startStat();
    }
    endStat() {
        this.cgStat.endStat();
    }
    printStat() {
        this.cgStat.printStat();
    }
    getStat() {
        return this.cgStat.getStat();
    }
    setDummyMainFuncID(dummyMainMethodID) {
        this.dummyMainMethodID = dummyMainMethodID;
    }
    getDummyMainFuncID() {
        return this.dummyMainMethodID;
    }
    isUnknownMethod(funcID) {
        let method = this.getMethodByFuncID(funcID);
        if (method) {
            if (!(method.getDeclaringClassSignature().getDeclaringFileSignature().getFileName() === Const_1.UNKNOWN_FILE_NAME)) {
                return false;
            }
        }
        return true;
    }
    getGraphName() {
        return 'CG';
    }
    getCallSiteManager() {
        return this.csManager;
    }
    getCallSiteInfo(csID) {
        const callSite = this.csManager.getCallSiteById(csID);
        if (!callSite) {
            return '';
        }
        const callerMethod = this.getMethodByFuncID(callSite.callerFuncID);
        const calleeMethod = this.getMethodByFuncID(callSite.getCalleeFuncID());
        return `CS[${csID}]: {${callerMethod.toString()} -> ${calleeMethod.toString()}}`;
    }
}
exports.CallGraph = CallGraph;
