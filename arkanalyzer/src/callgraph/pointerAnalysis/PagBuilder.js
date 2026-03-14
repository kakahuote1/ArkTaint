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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.PagBuilder = exports.CSFuncID = void 0;
const CallGraph_1 = require("../model/CallGraph");
const Stmt_1 = require("../../core/base/Stmt");
const Expr_1 = require("../../core/base/Expr");
const Ref_1 = require("../../core/base/Ref");
const logger_1 = __importStar(require("../../utils/logger"));
const Local_1 = require("../../core/base/Local");
const Type_1 = require("../../core/base/Type");
const Constant_1 = require("../../core/base/Constant");
const Statistics_1 = require("../common/Statistics");
const Pag_1 = require("./Pag");
const TSConst_1 = require("../../core/common/TSConst");
const PointerAnalysisConfig_1 = require("./PointerAnalysisConfig");
const Context_1 = require("./context/Context");
const ContextSelector_1 = require("./context/ContextSelector");
const PluginManager_1 = require("./plugins/PluginManager");
const logger = logger_1.default.getLogger(logger_1.LOG_MODULE_TYPE.ARKANALYZER, 'PTA');
class CSFuncID {
    constructor(cid, fid) {
        this.cid = cid;
        this.funcID = fid;
    }
}
exports.CSFuncID = CSFuncID;
class PagBuilder {
    constructor(p, cg, s, config) {
        this.handledFunc = new Set();
        this.worklist = [];
        // TODO: change string to hash value
        this.staticField2UniqInstanceMap = new Map();
        this.instanceField2UniqInstanceMap = new Map();
        this.sdkMethodReturnValueMap = new Map();
        this.funcHandledThisRound = new Set();
        this.updatedNodesThisRound = new Map();
        this.singletonFuncMap = new Map();
        this.globalThisValue = new Local_1.Local(TSConst_1.GLOBAL_THIS_NAME);
        this.externalScopeVariableMap = new Map();
        this.retriggerNodesList = new Set();
        // Record arrow function object nodes: funcName -> function object node ID
        this.arrowFunctionObjectMap = new Map();
        this.pag = p;
        this.cg = cg;
        this.scale = config.analysisScale;
        this.funcPags = new Map();
        this.scene = s;
        this.pagStat = new Statistics_1.PAGStat();
        this.pluginManager = new PluginManager_1.PluginManager(p, this, cg);
        let kLimit = config.kLimit;
        switch (config.contextType) {
            case PointerAnalysisConfig_1.ContextType.CallSite:
                this.ctxSelector = new ContextSelector_1.KCallSiteContextSelector(kLimit);
                break;
            case PointerAnalysisConfig_1.ContextType.Obj:
                this.ctxSelector = new ContextSelector_1.KObjContextSelector(kLimit);
                break;
            case PointerAnalysisConfig_1.ContextType.Func:
                this.ctxSelector = new ContextSelector_1.KFuncContextSelector(kLimit);
                break;
            default:
                this.ctxSelector = new ContextSelector_1.KCallSiteContextSelector(kLimit);
                break;
        }
    }
    buildFuncPagAndAddToWorklist(cs) {
        if (this.worklist.includes(cs)) {
            return cs;
        }
        this.buildFuncPag(cs.funcID);
        if (this.isSingletonFunction(cs.funcID)) {
            cs.cid = Context_1.DUMMY_CID;
        }
        this.worklist.push(cs);
        return cs;
    }
    addToFuncHandledListThisRound(id) {
        if (this.funcHandledThisRound.has(id)) {
            return;
        }
        this.funcHandledThisRound.add(id);
    }
    buildForEntries(funcIDs) {
        this.worklist = [];
        funcIDs.forEach(funcID => {
            let cid = this.ctxSelector.emptyContext(funcID);
            let csFuncID = new CSFuncID(cid, funcID);
            this.buildFuncPagAndAddToWorklist(csFuncID);
        });
        this.handleReachable();
        this.globalThisPagNode = this.getOrNewGlobalThisNode(ContextSelector_1.emptyID);
        this.pag.addPagEdge(this.globalThisPagNode, this.globalThisPagNode, Pag_1.PagEdgeKind.Copy);
    }
    handleReachable() {
        if (this.worklist.length === 0) {
            return false;
        }
        this.funcHandledThisRound.clear();
        while (this.worklist.length > 0) {
            let csFunc = this.worklist.shift();
            this.buildPagFromFuncPag(csFunc.funcID, csFunc.cid);
            this.addToFuncHandledListThisRound(csFunc.funcID);
        }
        return true;
    }
    build() {
        for (let funcID of this.cg.getEntries()) {
            let cid = this.ctxSelector.emptyContext(funcID);
            let csFuncID = new CSFuncID(cid, funcID);
            this.buildFuncPagAndAddToWorklist(csFuncID);
            this.handleReachable();
        }
    }
    buildFuncPag(funcID) {
        if (this.funcPags.has(funcID)) {
            return false;
        }
        let arkMethod = this.cg.getArkMethodByFuncID(funcID);
        if (arkMethod == null) {
            return false;
        }
        let cfg = arkMethod.getCfg();
        if (!cfg) {
            // build as sdk method
            return this.pluginManager.processSDKFuncPag(funcID, arkMethod).handled;
        }
        logger.trace(`[build FuncPag] ${arkMethod.getSignature().toString()}`);
        let fpag = new Pag_1.FuncPag();
        for (let stmt of cfg.getStmts()) {
            if (stmt instanceof Stmt_1.ArkAssignStmt) {
                this.processExternalScopeValue(stmt.getRightOp(), funcID);
                // Add non-call edges
                let kind = this.getEdgeKindForAssignStmt(stmt);
                if (kind !== Pag_1.PagEdgeKind.Unknown) {
                    fpag.addInternalEdge(stmt, kind);
                    continue;
                }
                // handle call
                this.buildInvokeExprInStmt(stmt, fpag);
            }
            else if (stmt instanceof Stmt_1.ArkInvokeStmt && this.scale === PointerAnalysisConfig_1.PtaAnalysisScale.WholeProgram) {
                this.processExternalScopeValue(stmt.getInvokeExpr(), funcID);
                this.buildInvokeExprInStmt(stmt, fpag);
            }
            else {
                // TODO: need handle other type of stmt?
            }
        }
        this.funcPags.set(funcID, fpag);
        this.pagStat.numTotalFunction++;
        return true;
    }
    buildInvokeExprInStmt(stmt, fpag) {
        // TODO: discuss if we need a invokeStmt
        if (!stmt.getInvokeExpr()) {
            return;
        }
        let callSites = this.cg.getCallSiteByStmt(stmt);
        if (callSites.length !== 0) {
            // direct call or constructor call is already existing in CG
            // TODO: some ptr invoke stmt is recognized as Static invoke in tests/resources/callgraph/funPtrTest1/fnPtrTest4.ts
            // TODO: instance invoke(ptr invoke)
            callSites.forEach(cs => {
                if (this.cg.isUnknownMethod(cs.calleeFuncID)) {
                    fpag.addUnknownCallSite(cs);
                }
                else {
                    fpag.addNormalCallSite(cs);
                }
            });
            return;
        }
        let dycs = this.cg.getDynCallSiteByStmt(stmt);
        if (dycs) {
            this.addToDynamicCallSite(fpag, dycs);
        }
        else {
            logger.error(`can not find callSite by stmt: ${stmt.toString()}`);
        }
    }
    processExternalScopeValue(value, funcID) {
        let dummyMainFuncID = this.cg.getDummyMainFuncID();
        if (dummyMainFuncID && funcID === dummyMainFuncID) {
            return;
        }
        if (value instanceof Local_1.Local) {
            this.handleValueFromExternalScope(value, funcID);
        }
        else if (value instanceof Expr_1.ArkInstanceInvokeExpr) {
            value.getUses().forEach(v => {
                this.handleValueFromExternalScope(v, funcID);
            });
        }
    }
    /**
     * process Method level analysis only
     */
    createDummyParamValue(funcID) {
        let arkMethod = this.cg.getArkMethodByFuncID(funcID);
        if (!arkMethod) {
            return new Map();
        }
        let args = arkMethod.getParameters();
        if (!args) {
            return new Map();
        }
        let paramArr = new Map();
        // heapObj
        args.forEach((arg, index) => {
            let paramType = arg.getType();
            if (!(paramType instanceof Type_1.ClassType)) {
                return;
                // TODO: support more type
            }
            let argInstance = new Expr_1.ArkNewExpr(paramType);
            paramArr.set(index, argInstance);
        });
        return paramArr;
    }
    createDummyParamPagNodes(value, funcID) {
        let paramPagNodes = new Map();
        let method = this.cg.getArkMethodByFuncID(funcID);
        if (!method || !method.getCfg()) {
            return paramPagNodes;
        }
        value.forEach((v, index) => {
            let paramArkExprNode = this.pag.getOrNewNode(Context_1.DUMMY_CID, v);
            paramPagNodes.set(index, paramArkExprNode.getID());
        });
        return paramPagNodes;
    }
    buildPagFromFuncPag(funcID, cid) {
        let funcPag = this.funcPags.get(funcID);
        if (funcPag === undefined) {
            return;
        }
        if (this.handledFunc.has(`${cid}-${funcID}`)) {
            return;
        }
        this.addEdgesFromFuncPag(funcPag, cid, funcID);
        let interFuncPag = this.interFuncPags?.get(funcID);
        if (interFuncPag) {
            this.addEdgesFromInterFuncPag(interFuncPag, cid);
        }
        this.addCallsEdgesFromFuncPag(funcPag, cid);
        this.addDynamicCallSite(funcPag, funcID, cid);
        this.addUnknownCallSite(funcPag, funcID);
        // Check if this is an arrow function and set up its 'this' binding
        // Must be called after addEdgesFromFuncPag to ensure this node is created
        this.setupArrowFunctionThis(funcID, cid);
        this.handledFunc.add(`${cid}-${funcID}`);
    }
    /// Add Pag Nodes and Edges in function
    addEdgesFromFuncPag(funcPag, cid, funcID) {
        let inEdges = funcPag.getInternalEdges();
        if (inEdges === undefined) {
            return false;
        }
        let paramNodes;
        let paramRefIndex = 0;
        if (this.scale === PointerAnalysisConfig_1.PtaAnalysisScale.MethodLevel) {
            paramNodes = this.createDummyParamPagNodes(this.createDummyParamValue(funcID), funcID);
        }
        for (let e of inEdges) {
            // handle closure field ref
            if (e.src instanceof Ref_1.ClosureFieldRef) {
                this.addClosureEdges(e, cid);
                continue;
            }
            let srcPagNode = this.getOrNewPagNode(cid, e.src, e.stmt);
            let dstPagNode = this.getOrNewPagNode(cid, e.dst, e.stmt);
            this.pag.addPagEdge(srcPagNode, dstPagNode, e.kind, e.stmt);
            // Take place of the real stmt for return
            if (dstPagNode.getStmt() instanceof Stmt_1.ArkReturnStmt) {
                dstPagNode.setStmt(e.stmt);
            }
            // Record arrow function object node (for variable assignment, field assignment, etc.)
            if (srcPagNode instanceof Pag_1.PagFuncNode) {
                this.recordArrowFunctionObjectNode(srcPagNode, e.src);
            }
            // for demand-driven analysis, add fake parameter heapObj nodes
            if (e.src instanceof Ref_1.ArkParameterRef && this.scale === PointerAnalysisConfig_1.PtaAnalysisScale.MethodLevel) {
                let paramObjNodeID = paramNodes?.get(paramRefIndex++);
                if (!paramObjNodeID) {
                    continue;
                }
                this.pag.addPagEdge(this.pag.getNode(paramObjNodeID), srcPagNode, Pag_1.PagEdgeKind.Address);
            }
        }
        return true;
    }
    /**
     * handle closure field ref intra-procedural edge
     * @param edge the intra-procedural edge with ClosureFieldRef as src
     * @param cid
     */
    addClosureEdges(edge, cid) {
        let src = edge.src;
        let dst = edge.dst;
        let fieldName = src.getFieldName();
        let closureValues = src.getBase().getType().getClosures();
        // search out method closure local with closureFieldRef.fieldName
        let srcValue = closureValues.find(value => value.getName() === fieldName);
        let dstPagNode = this.getOrNewPagNode(cid, dst, edge.stmt);
        if (srcValue) {
            // unable to get parent method cid, connect all the value nodes in different cid
            let srcPagNodes = this.pag.getNodesByValue(srcValue);
            if (srcPagNodes) {
                srcPagNodes.forEach(srcNodeID => {
                    let srcNode = this.pag.getNode(srcNodeID);
                    this.pag.addPagEdge(srcNode, dstPagNode, edge.kind, edge.stmt);
                    this.retriggerNodesList.add(srcNodeID);
                });
            }
        }
        else {
            throw new Error(`error find closure local: ${fieldName}`);
        }
    }
    /// add Copy edges interprocedural
    addCallsEdgesFromFuncPag(funcPag, cid) {
        for (let cs of funcPag.getNormalCallSites()) {
            let ivkExpr = cs.callStmt.getInvokeExpr();
            const calleeFuncID = cs.getCalleeFuncID();
            let calleeCid = this.ctxSelector.selectContext(cid, cs, ContextSelector_1.emptyID, calleeFuncID);
            let calleeCGNode = this.cg.getNode(calleeFuncID);
            if (this.scale === PointerAnalysisConfig_1.PtaAnalysisScale.MethodLevel) {
                this.addStaticPagCallReturnEdge(cs, cid, calleeCid);
            }
            // Storage Plugin, SDK Plugin
            const pluginResult = this.pluginManager.processCallSite(cs, cid, ContextSelector_1.emptyID, this.cg);
            if (pluginResult.handled) {
                logger.debug(`[buildFuncPag] plugin handled call site ${cs.callStmt.toString()}`);
            }
            else {
                this.addStaticPagCallEdge(cs, cid, calleeCid);
            }
            // Add edge to thisRef for special calls
            if (calleeCGNode.getKind() === CallGraph_1.CallGraphNodeKind.constructor || calleeCGNode.getKind() === CallGraph_1.CallGraphNodeKind.intrinsic) {
                let callee = this.scene.getMethod(this.cg.getMethodByFuncID(cs.calleeFuncID));
                if (ivkExpr instanceof Expr_1.ArkInstanceInvokeExpr) {
                    this.addThisRefCallEdge(cid, ivkExpr.getBase(), callee, calleeCid, cs.callerFuncID);
                }
                else {
                    logger.debug(`constructor or intrinsic func is static ${ivkExpr.toString()}`);
                }
            }
            const callerMethod = this.cg.getArkMethodByFuncID(cs.callerFuncID);
            const calleeMethod = this.cg.getArkMethodByFuncID(calleeFuncID);
            if (!callerMethod || !calleeMethod) {
                logger.error(`can not find caller or callee method by funcID ${cs.callerFuncID} ${calleeFuncID}`);
                return false;
            }
            this.cg.addDirectOrSpecialCallEdge(callerMethod.getSignature(), calleeMethod.getSignature(), cs.callStmt);
        }
        return true;
    }
    addDynamicCallSite(funcPag, funcID, cid) {
        // add dyn callSite in funcpag to base node
        for (let cs of funcPag.getDynamicCallSites()) {
            let invokeExpr = cs.callStmt.getInvokeExpr();
            let base;
            if (invokeExpr instanceof Expr_1.ArkInstanceInvokeExpr) {
                base = invokeExpr.getBase();
            }
            else if (invokeExpr instanceof Expr_1.ArkPtrInvokeExpr && invokeExpr.getFuncPtrLocal() instanceof Local_1.Local) {
                base = invokeExpr.getFuncPtrLocal();
            }
            else if (invokeExpr instanceof Expr_1.ArkPtrInvokeExpr && invokeExpr.getFuncPtrLocal() instanceof Ref_1.AbstractFieldRef) {
                /**
                 * TODO: wait for IR change
                 * throw error in ptrInvoke with field ref
                 * this.field() // field is lambda expression
                 */
                continue;
            }
            // TODO: check base under different cid
            let baseNodeIDs = this.pag.getNodesByValue(base);
            if (!baseNodeIDs) {
                // bind the call site to export base
                let interProceduralLocal = this.getSourceValueFromExternalScope(base, funcID);
                if (interProceduralLocal) {
                    baseNodeIDs = this.pag.getNodesByValue(interProceduralLocal);
                }
            }
            if (!baseNodeIDs) {
                logger.warn(`[build dynamic call site] can not handle call site with base ${base.toString()}`);
                continue;
            }
            for (let nodeID of baseNodeIDs.values()) {
                let node = this.pag.getNode(nodeID);
                if (!(node instanceof Pag_1.PagLocalNode)) {
                    continue;
                }
                node.addRelatedDynCallSite(cs);
            }
            if (cs.callStmt instanceof Stmt_1.ArkAssignStmt) {
                this.getOrNewPagNode(cid, cs.callStmt.getLeftOp(), cs.callStmt);
            }
        }
    }
    addUnknownCallSite(funcPag, funcID) {
        let method = this.cg.getArkMethodByFuncID(funcID);
        if (!method) {
            throw new Error(`can not find ArkMethod by FuncID ${funcID}`);
        }
        let locals = method.getBody()?.getLocals();
        funcPag.getUnknownCallSites().forEach(unknownCallSite => {
            let calleeName = unknownCallSite.callStmt.getInvokeExpr()?.getMethodSignature().getMethodSubSignature().getMethodName();
            let base = locals.get(calleeName);
            if (!base) {
                return;
            }
            let baseNodeIDs = this.pag.getNodesByValue(base);
            if (!baseNodeIDs) {
                logger.warn(`[build dynamic call site] can not handle call site with base ${base.toString()}`);
                return;
            }
            for (let nodeID of baseNodeIDs.values()) {
                let node = this.pag.getNode(nodeID);
                if (!(node instanceof Pag_1.PagLocalNode)) {
                    continue;
                }
                node.addRelatedUnknownCallSite(unknownCallSite);
            }
        });
    }
    addDynamicCallEdge(cs, baseClassPTNode, cid) {
        let srcNodes = [];
        let ivkExpr = cs.callStmt.getInvokeExpr();
        let ptNode = this.pag.getNode(baseClassPTNode);
        let value = ptNode.getValue();
        let callees = this.getDynamicCallee(ptNode, value, ivkExpr, cs);
        for (let callee of callees) {
            if (!callee) {
                continue;
            }
            // get caller and callee CG node, add param and return value PAG edge
            let dstCGNode = this.cg.getCallGraphNodeByMethod(callee.getSignature());
            let callerNode = this.cg.getNode(cs.callerFuncID);
            if (!callerNode) {
                throw new Error('Can not get caller method node');
            }
            // update call graph
            // TODO: movo to cgbuilder
            this.cg.addDynamicCallEdge(callerNode.getID(), dstCGNode.getID(), cs.callStmt);
            if (this.cg.detectReachable(dstCGNode.getID(), callerNode.getID())) {
                return srcNodes;
            }
            let staticCS = this.cg.getCallSiteManager().cloneCallSiteFromDyn(cs, dstCGNode.getID());
            if (this.scale === PointerAnalysisConfig_1.PtaAnalysisScale.MethodLevel) {
                srcNodes.push(...this.addStaticPagCallReturnEdge(staticCS, cid, baseClassPTNode));
                continue;
            }
            // Storage Plugin, SDK Plugin, Function Plugin, Container Plugin
            const pluginResult = this.pluginManager.processCallSite(staticCS, cid, baseClassPTNode, this.cg);
            if (pluginResult.handled) {
                logger.debug(`[buildDynamicCallEdge] plugin handled call site ${cs.callStmt.toString()}`);
                srcNodes.push(...pluginResult.srcNodes);
                continue;
            }
            srcNodes.push(...this.processNormalMethodPagCallEdge(staticCS, cid, baseClassPTNode));
        }
        return srcNodes;
    }
    /**
     * all possible callee methods of a dynamic call site
     * handle both PtrInvokeExpr and InstanceInvokeExpr
     */
    getDynamicCallee(ptNode, value, ivkExpr, cs) {
        let callee = [];
        if (ptNode instanceof Pag_1.PagFuncNode) {
            // function ptr invoke
            let tempCallee = this.scene.getMethod(ptNode.getMethod());
            if (!callee) {
                return callee;
            }
            callee.push(tempCallee);
            return callee;
        }
        //else branch
        let calleeName = ivkExpr.getMethodSignature().getMethodSubSignature().getMethodName();
        // instance method invoke
        if (!(value instanceof Expr_1.ArkNewExpr || value instanceof Expr_1.ArkNewArrayExpr)) {
            return callee;
        }
        // try to get callee by MethodSignature
        const getClassSignature = (value) => {
            if (value instanceof Expr_1.ArkNewExpr) {
                return value.getType().getClassSignature();
            }
            return this.scene.getSdkGlobal('Array').getSignature();
        };
        const clsSig = getClassSignature(value);
        let cls = this.scene.getClass(clsSig);
        let tempCallee;
        while (!tempCallee && cls) {
            tempCallee = cls.getMethodWithName(calleeName) ?? undefined;
            cls = cls.getSuperClass();
        }
        if (!tempCallee) {
            tempCallee = this.scene.getMethod(ivkExpr.getMethodSignature()) ?? undefined;
        }
        if (!tempCallee && cs.args) {
            // while pts has {o_1, o_2} and invoke expr represents a method that only {o_1} has
            // return empty node when {o_2} come in
            // try to get callee by anonymous method in param
            for (let arg of cs.args) {
                // TODO: anonymous method param and return value pointer pass
                let argType = arg.getType();
                if (argType instanceof Type_1.FunctionType) {
                    callee.push(this.scene.getMethod(argType.getMethodSignature()));
                }
            }
        }
        else if (tempCallee) {
            callee.push(tempCallee);
        }
        return callee;
    }
    processNormalMethodPagCallEdge(staticCS, cid, baseClassPTNode) {
        let srcNodes = [];
        let ivkExpr = staticCS.callStmt.getInvokeExpr();
        let ptNode = this.pag.getNode(baseClassPTNode);
        let dstCGNode = this.cg.getNode(staticCS.calleeFuncID);
        let calleeCid = this.ctxSelector.selectContext(cid, staticCS, baseClassPTNode, dstCGNode.getID());
        let callee = this.cg.getArkMethodByFuncID(staticCS.calleeFuncID);
        // Dynamic call, Ptr call, normal SDK call
        srcNodes.push(...this.addStaticPagCallEdge(staticCS, cid, calleeCid, ptNode));
        // Pass base's pts to callee's this pointer
        if (!dstCGNode.isSdkMethod() && ivkExpr instanceof Expr_1.ArkInstanceInvokeExpr) {
            let srcBaseNode = this.addThisRefCallEdge(cid, ivkExpr.getBase(), callee, calleeCid, staticCS.callerFuncID);
            if (srcBaseNode !== -1) {
                srcNodes.push(srcBaseNode);
            }
        }
        else if (!dstCGNode.isSdkMethod() && ivkExpr instanceof Expr_1.ArkPtrInvokeExpr) {
            let originCS = ptNode.getCS();
            if (!originCS) {
                return srcNodes;
            }
            let thisValue = originCS.args[0];
            if (!(thisValue instanceof Local_1.Local)) {
                return srcNodes;
            }
            this.addThisRefCallEdge(ptNode.getOriginCid(), thisValue, callee, calleeCid, staticCS.callerFuncID);
        }
        return srcNodes;
    }
    handleUnkownDynamicCall(cs, cid) {
        let srcNodes = [];
        let callerNode = this.cg.getNode(cs.callerFuncID);
        let ivkExpr = cs.callStmt.getInvokeExpr();
        logger.warn('Handling unknown dyn call site : \n  ' + callerNode.getMethod().toString() + '\n  --> ' + ivkExpr.toString() + '\n  CID: ' + cid);
        let callees = [];
        let callee = null;
        callee = this.scene.getMethod(ivkExpr.getMethodSignature());
        if (!callee) {
            cs.args?.forEach(arg => {
                if (!(arg.getType() instanceof Type_1.FunctionType)) {
                    return;
                }
                callee = this.scene.getMethod(arg.getType().getMethodSignature());
                if (callee) {
                    callees.push(callee);
                }
            });
        }
        else {
            callees.push(callee);
        }
        if (callees.length === 0) {
            return srcNodes;
        }
        callees.forEach(callee => {
            let dstCGNode = this.cg.getCallGraphNodeByMethod(callee.getSignature());
            if (!callerNode) {
                throw new Error('Can not get caller method node');
            }
            logger.warn(`\tAdd call edge of unknown call ${callee.getSignature().toString()}`);
            this.cg.addDynamicCallEdge(callerNode.getID(), dstCGNode.getID(), cs.callStmt);
            if (!this.cg.detectReachable(dstCGNode.getID(), callerNode.getID())) {
                let staticCS = this.cg.getCallSiteManager().cloneCallSiteFromDyn(cs, dstCGNode.getID());
                let calleeCid = this.ctxSelector.selectContext(cid, staticCS, ContextSelector_1.emptyID, staticCS.calleeFuncID);
                let staticSrcNodes = this.addStaticPagCallEdge(staticCS, cid, calleeCid);
                srcNodes.push(...staticSrcNodes);
            }
        });
        return srcNodes;
    }
    handleUnprocessedCallSites(processedCallSites) {
        let reAnalyzeNodes = [];
        for (let funcID of this.funcHandledThisRound) {
            let funcPag = this.funcPags.get(funcID);
            if (!funcPag) {
                logger.error(`can not find funcPag of handled func ${funcID}`);
                continue;
            }
            let callSites = funcPag.getDynamicCallSites();
            const diffCallSites = new Set(Array.from(callSites).filter(item => !processedCallSites.has(item)));
            diffCallSites.forEach(cs => {
                let ivkExpr = cs.callStmt.getInvokeExpr();
                if (!(ivkExpr instanceof Expr_1.ArkInstanceInvokeExpr)) {
                    return;
                }
                // Get local of base class
                let base = ivkExpr.getBase();
                // TODO: remove this after multiple this local fixed
                base = this.getRealThisLocal(base, cs.callerFuncID);
                // Get PAG nodes for this base's local
                let ctx2NdMap = this.pag.getNodesByValue(base);
                if (!ctx2NdMap) {
                    return;
                }
                for (let [cid] of ctx2NdMap.entries()) {
                    reAnalyzeNodes.push(...this.handleUnkownDynamicCall(cs, cid));
                }
            });
        }
        return reAnalyzeNodes;
    }
    addThisRefCallEdge(cid, baseLocal, callee, calleeCid, callerFunID) {
        let thisRefNodeID = this.recordThisRefNode(callee, calleeCid);
        if (thisRefNodeID === -1) {
            return -1;
        }
        let thisRefNode = this.pag.getNode(thisRefNodeID);
        let srcBaseLocal = baseLocal;
        srcBaseLocal = this.getRealThisLocal(srcBaseLocal, callerFunID);
        let srcNodeId = this.pag.hasCtxNode(cid, srcBaseLocal);
        if (!srcNodeId) {
            // this check is for export local and closure use
            // replace the invoke base, because its origin base has no pag node
            let interProceduralLocal = this.getSourceValueFromExternalScope(srcBaseLocal, callerFunID);
            if (interProceduralLocal) {
                srcNodeId = this.pag.hasCtxNode(cid, interProceduralLocal);
            }
        }
        if (!srcNodeId) {
            throw new Error('Can not get base node');
        }
        this.pag.addPagEdge(this.pag.getNode(srcNodeId), thisRefNode, Pag_1.PagEdgeKind.This);
        return srcNodeId;
    }
    recordThisRefNode(callee, calleeCid) {
        if (!callee || !callee.getCfg()) {
            logger.error(`callee is null`);
            return -1;
        }
        let thisAssignStmt = callee
            .getCfg()
            ?.getStmts()
            .filter(s => s instanceof Stmt_1.ArkAssignStmt && s.getRightOp() instanceof Ref_1.ArkThisRef);
        let thisPtr = (thisAssignStmt?.[0]).getRightOp();
        if (!thisPtr) {
            throw new Error('Can not get this ptr');
        }
        let thisRefNode = this.getOrNewPagNode(calleeCid, thisPtr);
        return thisRefNode.getID();
    }
    /*
     * Add copy edges from arguments to parameters
     *     ret edges from return values to callSite
     * Return src node
     */
    addStaticPagCallEdge(cs, callerCid, calleeCid, ptNode) {
        if (!calleeCid) {
            calleeCid = this.ctxSelector.selectContext(callerCid, cs, ptNode ? ptNode.getID() : ContextSelector_1.emptyID, cs.calleeFuncID);
        }
        let srcNodes = [];
        // Add reachable
        let calleeNode = this.cg.getNode(cs.calleeFuncID);
        let calleeMethod = this.scene.getMethod(calleeNode.getMethod());
        if (!calleeMethod) {
            // TODO: check if nodes need to delete
            return srcNodes;
        }
        if (calleeNode.isSdkMethod()) {
            logger.warn(`SDK method ${calleeMethod.getSignature().toString()} should be handled by plugin (ignored)`);
            return srcNodes;
        }
        if (!calleeMethod.getCfg()) {
            // method have no cfg body
            return srcNodes;
        }
        let calleeCS = this.buildFuncPagAndAddToWorklist(new CSFuncID(calleeCid, cs.calleeFuncID));
        // callee cid will updated if callee is singleton
        calleeCid = calleeCS.cid;
        let realArgs = cs.args ?? [];
        let argsOffset = 0;
        if (ptNode && ptNode instanceof Pag_1.PagFuncNode && ptNode.getCS()) {
            // for ptr invoke cloned by Function.bind()
            realArgs = ptNode.getCS().args ?? [];
            argsOffset = ptNode.getArgsOffset() ?? 0;
            callerCid = ptNode.getOriginCid() ?? callerCid;
        }
        srcNodes.push(...this.addCallParamPagEdge(calleeMethod, realArgs, cs, callerCid, calleeCid, argsOffset));
        srcNodes.push(...this.addCallReturnPagEdge(calleeMethod, cs.callStmt, callerCid, calleeCid));
        return srcNodes;
    }
    /**
     * only process the param PAG edge for invoke stmt
     */
    addCallParamPagEdge(calleeMethod, args, cs, callerCid, calleeCid, offset) {
        let callStmt = cs.callStmt;
        const params = this.pluginManager.getSDKParamValue(calleeMethod) ??
            calleeMethod
                .getCfg()
                .getStmts()
                .filter(stmt => stmt instanceof Stmt_1.ArkAssignStmt && stmt.getRightOp() instanceof Ref_1.ArkParameterRef)
                .map(stmt => stmt.getRightOp());
        let srcNodes = [];
        // add args to parameters edges
        for (let i = offset; i <= args.length; i++) {
            let arg = args[i];
            let param = params[i - offset];
            if (!arg || !param) {
                return srcNodes;
            }
            if (arg instanceof Constant_1.Constant || arg instanceof Expr_1.AbstractExpr) {
                // TODO: handle AbstractExpr
                continue;
            }
            // Get or create new PAG node for argument and parameter
            let srcPagNode = this.getOrNewPagNode(callerCid, arg, callStmt);
            let dstPagNode = this.getOrNewPagNode(calleeCid, param, callStmt);
            // Record arrow function object node for later thisPt setup
            if (srcPagNode instanceof Pag_1.PagFuncNode) {
                this.recordArrowFunctionObjectNode(srcPagNode, arg);
            }
            this.pag.addPagEdge(srcPagNode, dstPagNode, Pag_1.PagEdgeKind.Copy, callStmt);
            srcNodes.push(srcPagNode.getID());
            // TODO: handle other types of parmeters
        }
        return srcNodes;
    }
    /**
     * process the return value PAG edge for invoke stmt
     */
    addCallReturnPagEdge(calleeMethod, callStmt, callerCid, calleeCid) {
        let srcNodes = [];
        // add ret to caller edges
        let retStmts = calleeMethod.getReturnStmt();
        // TODO: call statement must be a assignment state
        if (callStmt instanceof Stmt_1.ArkAssignStmt) {
            let retDst = callStmt.getLeftOp();
            for (let retStmt of retStmts) {
                let retValue = retStmt.getOp();
                if (retValue instanceof Local_1.Local) {
                    let srcPagNode = this.getOrNewPagNode(calleeCid, retValue, retStmt);
                    let dstPagNode = this.getOrNewPagNode(callerCid, retDst, callStmt);
                    this.pag.addPagEdge(srcPagNode, dstPagNode, Pag_1.PagEdgeKind.Copy, retStmt);
                }
                else if (retValue instanceof Constant_1.Constant) {
                    continue;
                }
                else if (retValue instanceof Expr_1.AbstractExpr) {
                    logger.debug(retValue);
                    continue;
                }
                else {
                    throw new Error('return dst not a local or constant, but: ' + retValue.getType().toString());
                }
            }
        }
        return srcNodes;
    }
    /**
     * for method level call graph, add return edge
     */
    addStaticPagCallReturnEdge(cs, cid, baseClassPTNode) {
        let srcNodes = [];
        // Add reachable
        let calleeNode = this.cg.getNode(cs.calleeFuncID);
        let calleeMethod = this.scene.getMethod(calleeNode.getMethod());
        let calleeCid = this.ctxSelector.selectContext(cid, cs, baseClassPTNode, cs.calleeFuncID);
        if (!calleeMethod) {
            // TODO: check if nodes need to delete
            return srcNodes;
        }
        srcNodes.push(...this.addSDKMethodReturnPagEdge(cs, cid, calleeCid, calleeMethod)); // TODO: ???? why sdk
        return srcNodes;
    }
    addSDKMethodReturnPagEdge(cs, callerCid, calleeCid, calleeMethod) {
        let srcNodes = [];
        let returnType = calleeMethod.getReturnType();
        if (!(returnType instanceof Type_1.ClassType) || !(cs.callStmt instanceof Stmt_1.ArkAssignStmt)) {
            return srcNodes;
        }
        // check fake heap object exists or not
        let cidMap = this.sdkMethodReturnValueMap.get(calleeMethod);
        if (!cidMap) {
            cidMap = new Map();
        }
        let newExpr = cidMap.get(calleeCid);
        if (!newExpr) {
            if (returnType instanceof Type_1.ClassType) {
                newExpr = new Expr_1.ArkNewExpr(returnType);
            }
        }
        cidMap.set(calleeCid, newExpr);
        this.sdkMethodReturnValueMap.set(calleeMethod, cidMap);
        let srcPagNode = this.getOrNewPagNode(calleeCid, newExpr);
        let dstPagNode = this.getOrNewPagNode(callerCid, cs.callStmt.getLeftOp(), cs.callStmt);
        this.pag.addPagEdge(srcPagNode, dstPagNode, Pag_1.PagEdgeKind.Address, cs.callStmt);
        srcNodes.push(srcPagNode.getID());
        return srcNodes;
    }
    getOrNewPagNode(cid, v, s) {
        // globalThis process can not be removed while all `globalThis` ref is the same Value
        if (v instanceof Local_1.Local && v.getName() === TSConst_1.GLOBAL_THIS_NAME && v.getDeclaringStmt() == null) {
            // globalThis node has no cid
            return this.getOrNewGlobalThisNode(-1);
        }
        if (v instanceof Ref_1.ArkInstanceFieldRef || v instanceof Ref_1.ArkStaticFieldRef) {
            v = this.getRealInstanceRef(v);
        }
        return this.pag.getOrNewNode(cid, v, s);
    }
    getOrNewGlobalThisNode(cid) {
        return this.pag.getOrNewNode(cid, this.getGlobalThisValue());
    }
    /*
     * In ArkIR, ArkField has multiple instances for each stmt which use it
     * But the unique one is needed for pointer analysis
     * This is a temp solution to use a ArkField->(first instance)
     *  as the unique instance
     *
     * node merge condition:
     * instance field: value and ArkField
     * static field: ArkField
     */
    getRealInstanceRef(v) {
        if (!(v instanceof Ref_1.ArkInstanceFieldRef || v instanceof Ref_1.ArkStaticFieldRef)) {
            return v;
        }
        let sig = v.getFieldSignature();
        let sigStr = sig.toString();
        let base;
        let real;
        if (v instanceof Ref_1.ArkInstanceFieldRef) {
            base = v.getBase();
            if (base instanceof Local_1.Local && base.getName() === TSConst_1.GLOBAL_THIS_NAME && base.getDeclaringStmt() == null) {
                // replace the base in fieldRef
                base = this.getGlobalThisValue();
                v.setBase(base);
            }
            let key = `${base.getSignature()}-${sigStr}`;
            real = this.instanceField2UniqInstanceMap.get(key);
            if (!real) {
                this.instanceField2UniqInstanceMap.set(key, v);
                real = v;
            }
        }
        else {
            real = this.staticField2UniqInstanceMap.get(sigStr);
            if (!real) {
                this.staticField2UniqInstanceMap.set(sigStr, v);
                real = v;
            }
        }
        return real;
    }
    /**
     * check if a method is singleton function
     * rule: static method, assign heap obj to global var or static field, return the receiver
     */
    isSingletonFunction(funcID) {
        if (this.singletonFuncMap.has(funcID)) {
            return this.singletonFuncMap.get(funcID);
        }
        let arkMethod = this.cg.getArkMethodByFuncID(funcID);
        if (!arkMethod) {
            this.singletonFuncMap.set(funcID, false);
            return false;
        }
        if (!arkMethod.isStatic()) {
            this.singletonFuncMap.set(funcID, false);
            return false;
        }
        let funcPag = this.funcPags.get(funcID);
        let heapObjects = [...funcPag.getInternalEdges()].filter(edge => edge.kind === Pag_1.PagEdgeKind.Address).map(edge => edge.dst);
        let returnValues = arkMethod.getReturnValues();
        let result = this.isValueConnected([...funcPag.getInternalEdges()], heapObjects, returnValues);
        this.singletonFuncMap.set(funcID, result);
        if (result) {
            logger.info(`function ${funcID} is marked as singleton function`);
        }
        return result;
    }
    isValueConnected(edges, leftNodes, targetNodes) {
        // build funcPag graph
        const graph = new Map();
        let hasStaticFieldOrGlobalVar = false;
        for (const edge of edges) {
            let dst = this.getRealInstanceRef(edge.dst);
            let src = this.getRealInstanceRef(edge.src);
            if (!graph.has(dst)) {
                graph.set(dst, []);
            }
            if (!graph.has(src)) {
                graph.set(src, []);
            }
            if (dst instanceof Ref_1.ArkStaticFieldRef || src instanceof Ref_1.ArkStaticFieldRef) {
                hasStaticFieldOrGlobalVar = true;
            }
            graph.get(src).push(dst);
        }
        if (!hasStaticFieldOrGlobalVar) {
            return false;
        }
        for (const targetNode of targetNodes) {
            for (const leftNode of leftNodes) {
                const visited = new Set();
                let meetStaticField = false;
                if (this.funcPagDfs(graph, visited, leftNode, targetNode, meetStaticField)) {
                    return true; // a value pair that satisfy condition
                }
                if (!meetStaticField) {
                    break; // heap obj will not deal any more
                }
            }
        }
        return false;
    }
    funcPagDfs(graph, visited, currentNode, targetNode, staticFieldFound) {
        if (currentNode === targetNode) {
            return staticFieldFound;
        }
        visited.add(currentNode);
        for (const neighbor of graph.get(currentNode) || []) {
            // TODO: add global variable
            const isSpecialNode = neighbor instanceof Ref_1.ArkStaticFieldRef;
            if (!visited.has(neighbor)) {
                if (isSpecialNode) {
                    staticFieldFound = true;
                }
                if (this.funcPagDfs(graph, visited, neighbor, targetNode, staticFieldFound)) {
                    return true;
                }
            }
        }
        return false;
    }
    getGlobalThisValue() {
        return this.globalThisValue;
    }
    getEdgeKindForAssignStmt(stmt) {
        if (this.stmtIsCreateAddressObj(stmt)) {
            return Pag_1.PagEdgeKind.Address;
        }
        if (this.stmtIsCopyKind(stmt)) {
            return Pag_1.PagEdgeKind.Copy;
        }
        if (this.stmtIsReadKind(stmt)) {
            return Pag_1.PagEdgeKind.Load;
        }
        if (this.stmtIsWriteKind(stmt)) {
            return Pag_1.PagEdgeKind.Write;
        }
        return Pag_1.PagEdgeKind.Unknown;
    }
    /**\
     * ArkNewExpr, ArkNewArrayExpr, function ptr, globalThis
     */
    stmtIsCreateAddressObj(stmt) {
        let lhOp = stmt.getLeftOp();
        let rhOp = stmt.getRightOp();
        if (rhOp instanceof Expr_1.ArkNewExpr ||
            rhOp instanceof Expr_1.ArkNewArrayExpr ||
            (lhOp instanceof Local_1.Local &&
                ((rhOp instanceof Local_1.Local && rhOp.getType() instanceof Type_1.FunctionType && rhOp.getDeclaringStmt() === null) ||
                    (rhOp instanceof Ref_1.AbstractFieldRef && rhOp.getType() instanceof Type_1.FunctionType))) ||
            (rhOp instanceof Local_1.Local && rhOp.getName() === TSConst_1.GLOBAL_THIS_NAME && rhOp.getDeclaringStmt() == null)) {
            return true;
        }
        // TODO: add other Address Obj creation
        // like static object
        return false;
    }
    stmtIsCopyKind(stmt) {
        let lhOp = stmt.getLeftOp();
        let rhOp = stmt.getRightOp();
        let condition = (lhOp instanceof Local_1.Local &&
            (rhOp instanceof Local_1.Local || rhOp instanceof Ref_1.ArkParameterRef ||
                rhOp instanceof Ref_1.ArkThisRef || rhOp instanceof Ref_1.ArkStaticFieldRef ||
                rhOp instanceof Ref_1.ClosureFieldRef)) ||
            (lhOp instanceof Ref_1.ArkStaticFieldRef && rhOp instanceof Local_1.Local);
        if (condition) {
            return true;
        }
        return false;
    }
    stmtIsWriteKind(stmt) {
        let lhOp = stmt.getLeftOp();
        let rhOp = stmt.getRightOp();
        if (rhOp instanceof Local_1.Local && (lhOp instanceof Ref_1.ArkInstanceFieldRef || lhOp instanceof Ref_1.ArkArrayRef)) {
            return true;
        }
        return false;
    }
    stmtIsReadKind(stmt) {
        let lhOp = stmt.getLeftOp();
        let rhOp = stmt.getRightOp();
        if (lhOp instanceof Local_1.Local && (rhOp instanceof Ref_1.ArkInstanceFieldRef || rhOp instanceof Ref_1.ArkArrayRef)) {
            return true;
        }
        return false;
    }
    addToDynamicCallSite(funcPag, cs) {
        funcPag.addDynamicCallSite(cs);
        this.pagStat.numDynamicCall++;
        logger.trace('[add dynamic callSite] ' + cs.callStmt.toString() + ':  ' + cs.callStmt.getCfg()?.getDeclaringMethod().getSignature().toString());
    }
    setPtForNode(node, pts) {
        if (!pts) {
            return;
        }
        this.pag.getNode(node).setPointTo(pts);
    }
    getRealThisLocal(input, funcId) {
        if (input.getName() !== 'this') {
            return input;
        }
        let real = input;
        let f = this.cg.getArkMethodByFuncID(funcId);
        f
            ?.getCfg()
            ?.getStmts()
            .forEach(s => {
            if (s instanceof Stmt_1.ArkAssignStmt && s.getLeftOp() instanceof Local_1.Local) {
                if (s.getLeftOp().getName() === 'this') {
                    real = s.getLeftOp();
                    return;
                }
            }
        });
        return real;
    }
    doStat() {
        this.pagStat.numTotalNode = this.pag.getNodeNum();
    }
    printStat() {
        this.pagStat.printStat();
    }
    getStat() {
        return this.pagStat.getStat();
    }
    getUnhandledFuncs() {
        let handledFuncs = this.getHandledFuncs();
        let unhandleFuncs = Array.from(this.cg.getNodesIter())
            .filter(f => !handledFuncs.includes(f.getID()))
            .map(f => f.getID());
        return unhandleFuncs;
    }
    getHandledFuncs() {
        return Array.from(this.funcPags.keys());
    }
    /**
     * build export edge in internal func pag
     * @param value: Value that need to check if it is from import/export
     * @param originValue: if Value if InstanceFieldRef, the base will be passed to `value` recursively,
     *                      fieldRef will be passed to `originValue`
     */
    handleValueFromExternalScope(value, funcID, originValue) {
        if (value instanceof Local_1.Local) {
            if (value.getDeclaringStmt() || value.getName() === 'this') {
                // not from external scope
                return;
            }
            if (!value.getType()) {
                return;
            }
            let srcLocal = this.getSourceValueFromExternalScope(value, funcID);
            if (srcLocal) {
                // if `value` is from field base, use origin value(fieldRef) instead
                this.addInterFuncEdge(srcLocal, originValue ?? value, funcID);
            }
        }
        else if (value instanceof Ref_1.ArkInstanceFieldRef) {
            let base = value.getBase();
            if (base) {
                this.handleValueFromExternalScope(base, funcID, value);
            }
        }
    }
    addInterFuncEdge(src, dst, funcID) {
        this.interFuncPags = this.interFuncPags ?? new Map();
        let interFuncPag = this.interFuncPags.get(funcID) ?? new Pag_1.InterFuncPag();
        // Export a local
        // Add a InterProcedural edge
        if (dst instanceof Local_1.Local) {
            let e = {
                src: src,
                dst: dst,
                kind: Pag_1.PagEdgeKind.InterProceduralCopy,
            };
            interFuncPag.addToInterProceduralEdgeSet(e);
            this.addExportVariableMap(src, dst);
        }
        else if (dst instanceof Ref_1.ArkInstanceFieldRef) {
            // record the export base use
            this.addExportVariableMap(src, dst.getBase());
        }
        this.interFuncPags.set(funcID, interFuncPag);
        // Put the function which the src belongs to to worklist
        let srcFunc = src.getDeclaringStmt()?.getCfg().getDeclaringMethod();
        if (srcFunc) {
            let srcFuncID = this.cg.getCallGraphNodeByMethod(srcFunc.getSignature()).getID();
            let cid = this.ctxSelector.emptyContext(funcID);
            let csFuncID = new CSFuncID(cid, srcFuncID);
            this.buildFuncPagAndAddToWorklist(csFuncID);
        }
        // Extend other types of src here
    }
    getSourceValueFromExternalScope(value, funcID) {
        let sourceValue;
        sourceValue = this.getDefaultMethodSourceValue(value, funcID);
        if (!sourceValue) {
            sourceValue = this.getExportSourceValue(value, funcID);
        }
        return sourceValue;
    }
    getDefaultMethodSourceValue(value, funcID) {
        // namespace check
        let arkMethod = this.cg.getArkMethodByFuncID(funcID);
        if (!arkMethod) {
            return undefined;
        }
        let declaringNameSpace = arkMethod.getDeclaringArkClass().getDeclaringArkNamespace();
        while (declaringNameSpace) {
            let nameSpaceLocals = declaringNameSpace.getDefaultClass().getDefaultArkMethod()?.getBody()?.getLocals() ?? new Map();
            if (nameSpaceLocals.has(value.getName())) {
                return nameSpaceLocals.get(value.getName());
            }
            declaringNameSpace = declaringNameSpace.getDeclaringArkNamespace() ?? undefined;
        }
        // file check
        let declaringFile = arkMethod.getDeclaringArkFile();
        let fileLocals = declaringFile.getDefaultClass().getDefaultArkMethod()?.getBody()?.getLocals() ?? new Map();
        if (!fileLocals.has(value.getName())) {
            return undefined;
        }
        return fileLocals.get(value.getName());
    }
    getExportSourceValue(value, funcID) {
        let curMethod = this.cg.getArkMethodByFuncID(funcID);
        if (!curMethod) {
            return undefined;
        }
        let curFile = curMethod.getDeclaringArkFile();
        let impInfo = curFile.getImportInfoBy(value.getName());
        if (!impInfo) {
            return undefined;
        }
        let exportSource = impInfo.getLazyExportInfo();
        if (!exportSource) {
            return undefined;
        }
        let exportSouceValue = exportSource.getArkExport();
        if (exportSouceValue instanceof Local_1.Local) {
            return exportSouceValue;
        }
        return undefined;
    }
    addExportVariableMap(src, dst) {
        let exportMap = this.externalScopeVariableMap.get(src) ?? [];
        if (!exportMap.includes(dst)) {
            exportMap.push(dst);
            this.externalScopeVariableMap.set(src, exportMap);
        }
    }
    getExportVariableMap(src) {
        return this.externalScopeVariableMap.get(src) ?? [];
    }
    /// Add inter-procedural Pag Nodes and Edges
    addEdgesFromInterFuncPag(interFuncPag, cid) {
        let edges = interFuncPag.getInterProceduralEdges();
        if (edges.size === 0) {
            return false;
        }
        for (let e of edges) {
            // Existing local exported nodes -> ExportNode
            let exportLocal = e.src;
            let dstPagNode = this.getOrNewPagNode(cid, e.dst);
            // get export local node in all cid
            let existingNodes = this.pag.getNodesByValue(exportLocal);
            existingNodes?.forEach(n => {
                this.pag.addPagEdge(this.pag.getNode(n), dstPagNode, e.kind);
                this.retriggerNodesList.add(n);
            });
        }
        return true;
    }
    getRetriggerNodes() {
        let retriggerNodes = Array.from(this.retriggerNodesList);
        this.retriggerNodesList.clear();
        return retriggerNodes;
    }
    addUpdatedNode(nodeID, diffPT) {
        let ptaConfig = PointerAnalysisConfig_1.PointerAnalysisConfig.getInstance();
        let updatedNode = this.updatedNodesThisRound.get(nodeID) ?? new ptaConfig.ptsCollectionCtor();
        updatedNode.union(diffPT);
        this.updatedNodesThisRound.set(nodeID, updatedNode);
    }
    getUpdatedNodes() {
        return this.updatedNodesThisRound;
    }
    resetUpdatedNodes() {
        this.updatedNodesThisRound.clear();
    }
    getContextSelector() {
        return this.ctxSelector;
    }
    /**
     * Record arrow function object node for later thisPt setup
     */
    recordArrowFunctionObjectNode(funcNode, funcValue) {
        const methodSig = funcNode.getMethod();
        if (!methodSig) {
            return;
        }
        const funcName = methodSig.getMethodSubSignature().getMethodName();
        // Only record arrow functions (name contains %AM)
        if (funcName.includes('%AM')) {
            this.arrowFunctionObjectMap.set(funcName, funcNode.getID());
            logger.debug(`Recorded arrow function object: ${funcName} -> Node ${funcNode.getID()}`);
        }
    }
    /**
     * Set up 'this' binding for arrow functions
     * 1. Set the thisPt of arrow function object node (pointing to ThisRef node inside arrow function body)
     * 2. Establish This edge from arrow function's ThisRef to outer function's this
     */
    setupArrowFunctionThis(funcID, cid) {
        const arkMethod = this.cg.getArkMethodByFuncID(funcID);
        if (!arkMethod) {
            return;
        }
        // Check if this is an arrow function (name contains %AM)
        const funcName = arkMethod.getName();
        if (!funcName.includes('%AM')) {
            return;
        }
        logger.debug(`Setting up arrow function this for ${funcName} (FuncID: ${funcID}, Ctx: ${cid})`);
        // 1. Get ThisRef node inside the arrow function body
        const arrowFuncThisRefID = this.recordThisRefNode(arkMethod, cid);
        if (arrowFuncThisRefID === -1) {
            return;
        }
        // 2. Look up arrow function object node from map (O(1))
        const arrowFuncObjNodeID = this.arrowFunctionObjectMap.get(funcName);
        if (arrowFuncObjNodeID !== undefined) {
            const funcNode = this.pag.getNode(arrowFuncObjNodeID);
            funcNode.setThisPt(arrowFuncThisRefID);
            logger.debug(`Set function object node ${arrowFuncObjNodeID} thisPt to ThisRef ${arrowFuncThisRefID}`);
        }
        else {
            logger.warn(`Arrow function object node not found for ${funcName}`);
        }
        // 3. Get the outer function of arrow function and establish This edge
        const outerMethod = arkMethod.getOuterMethod();
        if (!outerMethod) {
            logger.warn(`Could not find outer method for arrow function ${funcName}`);
            return;
        }
        logger.debug(`Arrow function outer method: ${outerMethod.getName()}`);
        // Get context of arrow function object node (in which context of outer function the arrow function object is created)
        const arrowFuncObjNode = arrowFuncObjNodeID !== undefined ? this.pag.getNode(arrowFuncObjNodeID) : undefined;
        const outerContextID = arrowFuncObjNode?.getCid();
        // Find 'this' local node of outer function in specified context
        const outerThisNode = this.findThisNodeForMethod(outerMethod, outerContextID);
        if (outerThisNode) {
            const arrowFuncThisRef = this.pag.getNode(arrowFuncThisRefID);
            // Establish This edge: outer this -> arrow function ThisRef
            if (this.pag.addPagEdge(outerThisNode, arrowFuncThisRef, Pag_1.PagEdgeKind.This)) {
                logger.info(`Connected arrow function ${funcName} this (Node ${arrowFuncThisRefID}) to outer this (Node ${outerThisNode.getID()})`);
                // Add outer this node to retrigger list to ensure pointer propagation
                this.retriggerNodesList.add(outerThisNode.getID());
            }
        }
    }
    /**
     * Find 'this' local node for the specified method in the specified context
     * @param method Target method
     * @param contextID Optional context ID. If not specified, returns the 'this' node in the first found context
     */
    findThisNodeForMethod(method, contextID) {
        const cfg = method.getCfg();
        if (!cfg) {
            return undefined;
        }
        // Find 'this' assignment statement in method: this = this: ClassName
        const thisAssignStmt = cfg
            .getStmts()
            .find(s => s instanceof Stmt_1.ArkAssignStmt && s.getRightOp() instanceof Ref_1.ArkThisRef);
        if (!thisAssignStmt) {
            return undefined;
        }
        const thisLocal = thisAssignStmt.getLeftOp();
        if (!(thisLocal instanceof Local_1.Local)) {
            return undefined;
        }
        const ctx2NodeMap = this.pag.getNodesByValue(thisLocal);
        if (!ctx2NodeMap || ctx2NodeMap.size === 0) {
            return undefined;
        }
        // If context is specified, find node in that context
        if (contextID !== undefined) {
            const nodeID = ctx2NodeMap.get(contextID);
            if (nodeID === undefined) {
                return undefined;
            }
            return this.pag.getNode(nodeID);
        }
        // Otherwise return 'this' node in the first found context
        const firstNodeID = ctx2NodeMap.values().next().value;
        if (firstNodeID === undefined) {
            return undefined;
        }
        return this.pag.getNode(firstNodeID);
    }
}
exports.PagBuilder = PagBuilder;
//# sourceMappingURL=PagBuilder.js.map