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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PointerAnalysis = void 0;
const path_1 = __importDefault(require("path"));
const fs = __importStar(require("fs"));
const CallGraph_1 = require("../model/CallGraph");
const AbstractAnalysis_1 = require("../algorithm/AbstractAnalysis");
const Type_1 = require("../../core/base/Type");
const CallGraphBuilder_1 = require("../model/builder/CallGraphBuilder");
const logger_1 = __importStar(require("../../utils/logger"));
const DummyMainCreater_1 = require("../../core/common/DummyMainCreater");
const Statistics_1 = require("../common/Statistics");
const Pag_1 = require("./Pag");
const PagBuilder_1 = require("./PagBuilder");
const PointerAnalysisConfig_1 = require("./PointerAnalysisConfig");
const PtsDS_1 = require("./PtsDS");
const Local_1 = require("../../core/base/Local");
const Context_1 = require("./context/Context");
const logger = logger_1.default.getLogger(logger_1.LOG_MODULE_TYPE.ARKANALYZER, 'PTA');
class PointerAnalysis extends AbstractAnalysis_1.AbstractAnalysis {
    constructor(p, cg, s, config) {
        super(s, cg);
        this.pag = p;
        this.ptd = new PtsDS_1.DiffPTData(config.ptsCollectionCtor);
        this.pagBuilder = new PagBuilder_1.PagBuilder(this.pag, this.cg, s, config);
        this.cgBuilder = new CallGraphBuilder_1.CallGraphBuilder(this.cg, s);
        this.ptaStat = new Statistics_1.PTAStat(this);
        this.config = config;
    }
    static pointerAnalysisForWholeProject(projectScene, config) {
        let cg = new CallGraph_1.CallGraph(projectScene);
        let cgBuilder = new CallGraphBuilder_1.CallGraphBuilder(cg, projectScene);
        cgBuilder.buildDirectCallGraphForScene();
        let pag = new Pag_1.Pag();
        if (!config) {
            config = PointerAnalysisConfig_1.PointerAnalysisConfig.create(1, 'out/', false, false);
        }
        const dummyMainCreator = new DummyMainCreater_1.DummyMainCreater(projectScene);
        dummyMainCreator.createDummyMain();
        const dummyMainMethod = dummyMainCreator.getDummyMain();
        cgBuilder.buildDirectCallGraph([dummyMainMethod]);
        let dummyMainMethodID = cg.getCallGraphNodeByMethod(dummyMainMethod.getSignature()).getID();
        cg.setDummyMainFuncID(dummyMainMethodID);
        let pta = new PointerAnalysis(pag, cg, projectScene, config);
        pta.setEntries([dummyMainMethodID]);
        pta.start();
        return pta;
    }
    static pointerAnalysisForMethod(s, method, config) {
        let cg = new CallGraph_1.CallGraph(s);
        let cgBuilder = new CallGraphBuilder_1.CallGraphBuilder(cg, s);
        cgBuilder.buildDirectCallGraphForScene();
        let pag = new Pag_1.Pag();
        if (!config) {
            config = PointerAnalysisConfig_1.PointerAnalysisConfig.create(1, 'out/', false, false);
        }
        let entryMethodID = cg.getCallGraphNodeByMethod(method.getSignature()).getID();
        let pta = new PointerAnalysis(pag, cg, s, config);
        pta.setEntries([entryMethodID]);
        pta.start();
        return pta;
    }
    init() {
        logger.warn(`========== Init Pointer Analysis ==========`);
        // start statistics
        this.ptaStat.startStat();
        // build funcPag with entries
        this.pagBuilder.buildForEntries(this.entries);
        if (this.config.dotDump) {
            this.pag.dump(path_1.default.join(this.config.outputDirectory, 'ptaInit_pag.dot'));
            this.cg.dump(path_1.default.join(this.config.outputDirectory, 'cg_init.dot'));
        }
    }
    start() {
        this.init();
        this.solveConstraint();
        this.postProcess();
    }
    postProcess() {
        this.ptaStat.endStat();
        this.pagBuilder.doStat();
        this.cg.printStat();
        this.pagBuilder.printStat();
        this.ptaStat.printStat();
        if (this.config.dotDump) {
            this.pag.dump(path_1.default.join(this.config.outputDirectory, 'ptaEnd_pag.dot'));
            this.cg.dump(path_1.default.join(this.config.outputDirectory, 'cgEnd.dot'));
        }
        if (this.config.debug) {
            this.dumpUnhandledFunctions();
            this.pagBuilder.getContextSelector().dump(this.config.outputDirectory, this.cg);
        }
    }
    getPTD() {
        return this.ptd;
    }
    getPag() {
        return this.pag;
    }
    getStat() {
        let ret = this.cg.getStat();
        ret += '\n' + this.pagBuilder.getStat();
        ret += '\n' + this.ptaStat.getStat();
        return ret;
    }
    preProcessMethod(funcID) {
        // do nothing
        return [];
    }
    setEntries(fIds) {
        this.entries = fIds;
    }
    solveConstraint() {
        this.worklist = [];
        logger.warn(`========== Pointer Analysis Start ==========`);
        this.initWorklist();
        let reanalyzer = true;
        while (reanalyzer) {
            this.ptaStat.iterTimes++;
            logger.warn(`========== Pointer Analysis Round ${this.ptaStat.iterTimes} ==========`);
            // do pointer transfer
            this.solveWorklist();
            // process dynamic call
            if (this.config.analysisScale === PointerAnalysisConfig_1.PtaAnalysisScale.WholeProgram || this.ptaStat.iterTimes === 1) {
                reanalyzer = this.onTheFlyDynamicCallSolve();
            }
            else {
                reanalyzer = false;
            }
            if (this.config.dotDump) {
                this.pag.dump(path_1.default.join(this.config.outputDirectory, `pta_pag_itor#${this.ptaStat.iterTimes}.dot`));
            }
        }
    }
    /**
     * get newly added Address Edge, and add them to initial WorkList
     */
    initWorklist() {
        let changed = false;
        this.addToReanalyze(this.pagBuilder.getRetriggerNodes());
        for (let e of this.pag.getAddrEdges()) {
            this.ptaStat.numProcessedAddr++;
            let { src, dst } = e.getEndPoints();
            this.ptd.addPts(dst, src);
            if (this.pag.getNode(src) instanceof Pag_1.PagGlobalThisNode) {
                // readd globalThis heapObj into workList
                this.ptd.addPts(src, src);
                this.worklist.push(src);
            }
            this.worklist.push(dst);
            changed = true;
        }
        this.pag.resetAddrEdges();
        return changed;
    }
    solveWorklist() {
        while (this.worklist.length > 0) {
            let node = this.worklist.shift();
            this.processNode(node);
        }
        return true;
    }
    processNode(nodeId) {
        this.handleThis(nodeId);
        this.handleLoadWrite(nodeId);
        this.handleCopy(nodeId);
        this.handlePt(nodeId);
        this.detectTypeDiff(nodeId);
        return true;
    }
    handleCopy(nodeID) {
        let node = this.pag.getNode(nodeID);
        node.getOutgoingCopyEdges()?.forEach(copyEdge => {
            this.propagate(copyEdge);
            this.ptaStat.numProcessedCopy++;
        });
        return true;
    }
    handleLoadWrite(nodeID) {
        let node = this.pag.getNode(nodeID);
        let nodeValue = node.getValue();
        let diffPts = this.ptd.getDiffPts(nodeID);
        if (!diffPts || diffPts.count() === 0) {
            return false;
        }
        // get related field node with current node's value
        let instanceFieldNodeMap = this.pag.getNodesByBaseValue(nodeValue) ?? new Map();
        // get intra procedural field node by exportMap
        let intraProceduralFieldNodeMap = new Map();
        if (nodeValue instanceof Local_1.Local) {
            this.pagBuilder.getExportVariableMap(nodeValue).forEach(dst => {
                let temp = this.pag.getNodesByBaseValue(dst) ?? new Map();
                intraProceduralFieldNodeMap = this.mergeInstanceFieldMap(instanceFieldNodeMap, temp);
            });
        }
        instanceFieldNodeMap.forEach((nodeIDs, cid) => {
            // TODO: check cid
            // cid === -1 will escape the check, mainly for globalThis
            // cid === CONTAINER_ELEMENT_CID will escape the check, for container element/field nodes
            let baseCid = node.getCid();
            if (baseCid !== -1 && cid !== Context_1.CONTAINER_ELEMENT_CID && cid !== baseCid) {
                return;
            }
            nodeIDs.forEach((nodeID) => {
                // get abstract field node
                let fieldNode = this.pag.getNode(nodeID);
                this.handleFieldInEdges(fieldNode, diffPts);
                this.handleFieldOutEdges(fieldNode, diffPts);
            });
        });
        // without cid check, because closure and export is under different cid
        intraProceduralFieldNodeMap.forEach(nodeIDs => {
            nodeIDs.forEach((nodeID) => {
                // get abstract field node
                let fieldNode = this.pag.getNode(nodeID);
                this.handleFieldInEdges(fieldNode, diffPts);
                this.handleFieldOutEdges(fieldNode, diffPts);
            });
        });
        return true;
    }
    handleFieldInEdges(fieldNode, diffPts) {
        fieldNode.getIncomingEdge().forEach(edge => {
            if (edge.getKind() !== Pag_1.PagEdgeKind.Write) {
                return;
            }
            let srcNode = edge.getSrcNode();
            this.ptaStat.numProcessedWrite++;
            for (let pt of diffPts) {
                // filter pt
                // clone the real field node with abstract field node
                let dstNode;
                if (fieldNode instanceof Pag_1.PagArrayNode) {
                    let arrayBase = fieldNode.getValue().getBase();
                    dstNode = this.pag.getOrClonePagContainerFieldNode(pt, arrayBase, 'Array');
                }
                else {
                    dstNode = this.pag.getOrClonePagFieldNode(fieldNode, pt);
                }
                if (!(dstNode && this.pag.addPagEdge(srcNode, dstNode, Pag_1.PagEdgeKind.Copy))) {
                    continue;
                }
                this.ptaStat.numRealWrite++;
                if (this.ptd.resetElem(srcNode.getID())) {
                    this.worklist.push(srcNode.getID());
                }
            }
        });
    }
    handleFieldOutEdges(fieldNode, diffPts) {
        fieldNode.getOutgoingEdges().forEach(edge => {
            if (edge.getKind() !== Pag_1.PagEdgeKind.Load) {
                return;
            }
            let dstNode = edge.getDstNode();
            this.ptaStat.numProcessedLoad++;
            for (let pt of diffPts) {
                let srcNode;
                if (fieldNode instanceof Pag_1.PagArrayNode) {
                    let arrayBase = fieldNode.getValue().getBase();
                    srcNode = this.pag.getOrClonePagContainerFieldNode(pt, arrayBase, 'Array');
                }
                else {
                    srcNode = this.pag.getOrClonePagFieldNode(fieldNode, pt);
                }
                if (!(srcNode && this.pag.addPagEdge(srcNode, dstNode, Pag_1.PagEdgeKind.Copy))) {
                    continue;
                }
                this.ptaStat.numRealLoad++;
                // TODO: if field is used before initialzed, newSrc node has no diff pts
                if (this.ptd.resetElem(srcNode.getID())) {
                    this.worklist.push(srcNode.getID());
                }
            }
        });
    }
    /**
     * If current node is a base of a called method, pointer in this node will be transfered into `this` Local in method
     */
    handleThis(nodeID) {
        let node = this.pag.getNode(nodeID);
        node.getOutgoingThisEdges()?.forEach(thisEdge => {
            this.propagate(thisEdge);
            this.ptaStat.numProcessedThis++;
        });
        return true;
    }
    handlePt(nodeID) {
        let realDiff = this.ptd.calculateDiff(nodeID, nodeID);
        if (realDiff.count() !== 0) {
            // record the updated nodes
            this.pagBuilder.addUpdatedNode(nodeID, realDiff);
        }
        this.ptd.flush(nodeID);
        this.pagBuilder.setPtForNode(nodeID, this.ptd.getPropaPts(nodeID));
    }
    propagate(edge) {
        let changed = false;
        let { src, dst } = edge.getEndPoints();
        let diffPts = this.ptd.getDiffPts(src);
        if (!diffPts) {
            return changed;
        }
        let realDiffPts = this.ptd.calculateDiff(src, dst);
        for (let pt of realDiffPts) {
            changed = this.ptd.addPts(dst, pt) || changed;
        }
        if (changed) {
            this.worklist.push(dst);
        }
        return changed;
    }
    /**
     * 1. 记录被更新的节点(记录cid, nodeid)
     * 2. ( PAGLocalNode记录callSite(cid, value唯一))，通过1种的nodeID查询Node,拿到CallSite
     * 3. 在addDynamicCall里对传入指针过滤（已处理指针和未处理指针）
     */
    onTheFlyDynamicCallSolve() {
        let changed = false;
        let processedCallSites = new Set();
        this.pagBuilder.getUpdatedNodes().forEach((pts, nodeID) => {
            let node = this.pag.getNode(nodeID);
            if (!(node instanceof Pag_1.PagLocalNode)) {
                logger.warn(`node ${nodeID} is not local node, value: ${node.getValue()}`);
                return;
            }
            changed = this.processDynCallSite(node, pts, processedCallSites) || changed;
            changed = this.processUnknownCallSite(node, pts) || changed;
        });
        this.pagBuilder.resetUpdatedNodes();
        let srcNodes = this.pagBuilder.handleUnprocessedCallSites(processedCallSites);
        changed = this.addToReanalyze(srcNodes) || changed;
        changed = this.pagBuilder.handleReachable() || changed;
        changed = this.initWorklist() || changed;
        return changed;
    }
    processDynCallSite(node, pts, processedCallSites) {
        let changed = false;
        let dynCallSites = node.getRelatedDynCallSites();
        if (!dynCallSites && !node.isSdkParam()) {
            logger.warn(`node ${node.getID()} has no related dynamic call site`);
            return changed;
        }
        logger.info(`[process dynamic callSite] node ${node.getID()}`);
        dynCallSites.forEach(dynCallSite => {
            for (let pt of pts) {
                let srcNodes = this.pagBuilder.addDynamicCallEdge(dynCallSite, pt, node.getCid());
                changed = this.addToReanalyze(srcNodes) || changed;
            }
            processedCallSites.add(dynCallSite);
        });
        return changed;
    }
    processUnknownCallSite(node, pts) {
        let changed = false;
        let unknownCallSites = node.getRelatedUnknownCallSites();
        if (!unknownCallSites) {
            logger.warn(`node ${node.getID()} has no related unknown call site`);
            return changed;
        }
        logger.info(`[process unknown callSite] node ${node.getID()}`);
        unknownCallSites.forEach(unknownCallSite => {
            for (let pt of pts) {
                let srcNodes = this.pagBuilder.addDynamicCallEdge(unknownCallSite, pt, node.getCid());
                changed = this.addToReanalyze(srcNodes) || changed;
            }
        });
        return changed;
    }
    addToReanalyze(startNodes) {
        let flag = false;
        for (let node of startNodes) {
            if (!this.worklist.includes(node) && this.ptd.resetElem(node)) {
                this.worklist.push(node);
                flag = true;
            }
        }
        return flag;
    }
    /**
     * compare interface
     */
    noAlias(leftValue, rightValue) {
        let leftValueNodes = this.pag.getNodesByValue(leftValue)?.values();
        let rightValueNodes = this.pag.getNodesByValue(rightValue)?.values();
        let leftValuePts = new Set();
        let rightValuePts = new Set();
        for (let nodeID of leftValueNodes) {
            let node = this.pag.getNode(nodeID);
            for (let pt of node.getPointTo()) {
                leftValuePts.add(pt);
            }
        }
        for (let nodeID of rightValueNodes) {
            let node = this.pag.getNode(nodeID);
            for (let pt of node.getPointTo()) {
                rightValuePts.add(pt);
            }
        }
        if (leftValuePts.size > rightValuePts.size) {
            [leftValuePts, rightValuePts] = [rightValuePts, leftValuePts];
        }
        for (const elem of leftValuePts) {
            if (rightValuePts.has(elem)) {
                return false;
            }
        }
        // no alias
        return true;
    }
    mayAlias(leftValue, rightValue) {
        return !this.noAlias(leftValue, rightValue);
    }
    getRelatedNodes(value) {
        let valueNodes = this.pag.getNodesByValue(value);
        let relatedAllNodes = new Set();
        let workListNodes = [];
        let processedNodes = new Set();
        if (valueNodes) {
            for (const nodeID of valueNodes.values()) {
                workListNodes.push(nodeID);
            }
        }
        while (workListNodes.length !== 0) {
            let valueNodeID = workListNodes.shift();
            if (processedNodes.has(valueNodeID)) {
                continue;
            }
            this.processRelatedNode(valueNodeID, workListNodes, processedNodes);
        }
        processedNodes.forEach(nodeID => {
            let valueNode = this.pag.getNode(nodeID);
            relatedAllNodes.add(valueNode.getValue());
        });
        return relatedAllNodes;
    }
    processRelatedNode(valueNodeID, workListNodes, processedNodes) {
        let valueNode = this.pag.getNode(valueNodeID);
        this.addIncomingEdgesToWorkList(valueNode, workListNodes, processedNodes);
        this.addOutgoingEdgesToWorkList(valueNode, workListNodes, processedNodes);
        processedNodes.add(valueNodeID);
    }
    addIncomingEdgesToWorkList(valueNode, workListNodes, processedNodes) {
        let inCopyEdges = valueNode.getIncomingCopyEdges();
        let inThisEdges = valueNode.getIncomingThisEdges();
        let combinedEdges = new Set([...(inCopyEdges ?? []), ...(inThisEdges ?? [])]);
        if (combinedEdges) {
            combinedEdges.forEach(edge => {
                let srcID = edge.getSrcID();
                if (!processedNodes.has(srcID)) {
                    workListNodes.push(srcID);
                }
            });
        }
    }
    addOutgoingEdgesToWorkList(valueNode, workListNodes, processedNodes) {
        let outCopyEdges = valueNode.getOutgoingCopyEdges();
        let outThisEdges = valueNode.getOutgoingThisEdges();
        let combinedEdges = new Set([...(outCopyEdges ?? []), ...(outThisEdges ?? [])]);
        if (combinedEdges) {
            combinedEdges.forEach(edge => {
                let dstID = edge.getDstID();
                if (!processedNodes.has(dstID)) {
                    workListNodes.push(dstID);
                }
            });
        }
    }
    detectTypeDiff(nodeId) {
        if (this.config.detectTypeDiff === false) {
            return;
        }
        this.typeDiffMap = this.typeDiffMap ?? new Map();
        let node = this.pag.getNode(nodeId);
        let value = node.getValue();
        let origType = node.getValue().getType();
        // TODO: union type
        if (!(origType instanceof Type_1.ClassType || origType instanceof Type_1.UnknownType)) {
            return;
        }
        let findSameType = false;
        let pts = node.getPointTo();
        if (pts.count() === 0) {
            return;
        }
        for (let pt of pts) {
            let ptNode = this.pag.getNode(pt);
            let type = ptNode.getValue().getType();
            if (type.toString() !== origType.toString()) {
                let diffSet = this.typeDiffMap.get(value) ?? new Set();
                this.typeDiffMap.set(value, diffSet);
                if (!diffSet.has(type)) {
                    diffSet.add(type);
                }
            }
            else {
                findSameType = true;
            }
        }
        // If find pts to original type,
        // need add original type back since it is a correct type
        let diffSet = this.typeDiffMap.get(value);
        if (diffSet && findSameType) {
            diffSet.add(origType);
        }
    }
    getTypeDiffMap() {
        return this.typeDiffMap ?? new Map();
    }
    resolveCall(sourceMethod, invokeStmt) {
        return [];
    }
    getUnhandledFuncs() {
        return this.pagBuilder.getUnhandledFuncs();
    }
    getHandledFuncs() {
        return this.pagBuilder.getHandledFuncs();
    }
    getPTAConfig() {
        return this.config;
    }
    dumpUnhandledFunctions() {
        const filePath = path_1.default.join(this.config.outputDirectory, 'PtaUnhandledFunctionList.txt');
        fs.access(filePath, fs.constants.F_OK, err => {
            if (!err) {
                fs.truncate(filePath, 0, err => {
                    err && logger.error('Error to truncate file ', err);
                });
            }
            let updatedContent = '';
            this.getUnhandledFuncs().forEach(funcID => {
                let cgNode = this.cg.getNode(funcID);
                if (cgNode.isSdkMethod()) {
                    return;
                }
                let f = this.cg.getArkMethodByFuncID(funcID);
                if (f) {
                    updatedContent += f.getSignature().toString() + '\n';
                }
            });
            fs.writeFile(filePath, updatedContent, 'utf8', err => {
                if (err) {
                    logger.error('Error to write file', err);
                }
            });
        });
    }
    mergeInstanceFieldMap(src, dst) {
        dst.forEach((value, key) => {
            if (src.has(key)) {
                src.set(key, [...src.get(key), ...value]);
            }
            else {
                src.set(key, value);
            }
        });
        return src;
    }
}
exports.PointerAnalysis = PointerAnalysis;
//# sourceMappingURL=PointerAnalysis.js.map