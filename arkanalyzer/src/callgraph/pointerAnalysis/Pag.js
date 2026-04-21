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
exports.InterFuncPag = exports.FuncPag = exports.Pag = exports.PagGlobalThisNode = exports.PagFuncNode = exports.PagParamNode = exports.PagNewContainerExprNode = exports.PagNewExprNode = exports.PagConstantNode = exports.PagArrayNode = exports.PagThisRefNode = exports.PagStaticFieldNode = exports.PagInstanceFieldNode = exports.PagLocalNode = exports.PagNode = exports.PagNodeKind = exports.ThisPagEdge = exports.WritePagEdge = exports.LoadPagEdge = exports.CopyPagEdge = exports.AddrPagEdge = exports.PagEdge = exports.PagEdgeKind = void 0;
const BaseExplicitGraph_1 = require("../../core/graph/BaseExplicitGraph");
const Stmt_1 = require("../../core/base/Stmt");
const Expr_1 = require("../../core/base/Expr");
const Ref_1 = require("../../core/base/Ref");
const Local_1 = require("../../core/base/Local");
const GraphPrinter_1 = require("../../save/GraphPrinter");
const PrinterBuilder_1 = require("../../save/PrinterBuilder");
const Constant_1 = require("../../core/base/Constant");
const Type_1 = require("../../core/base/Type");
const logger_1 = __importStar(require("../../utils/logger"));
const TSConst_1 = require("../../core/common/TSConst");
const ArkExport_1 = require("../../core/model/ArkExport");
const PTAUtils_1 = require("./PTAUtils");
const PointerAnalysisConfig_1 = require("./PointerAnalysisConfig");
const Context_1 = require("./context/Context");
const logger = logger_1.default.getLogger(logger_1.LOG_MODULE_TYPE.ARKANALYZER, 'PTA');
/*
 * Implementation of pointer-to assignment graph for pointer analysis
 */
var PagEdgeKind;
(function (PagEdgeKind) {
    PagEdgeKind[PagEdgeKind["Address"] = 0] = "Address";
    PagEdgeKind[PagEdgeKind["Copy"] = 1] = "Copy";
    PagEdgeKind[PagEdgeKind["Load"] = 2] = "Load";
    PagEdgeKind[PagEdgeKind["Write"] = 3] = "Write";
    PagEdgeKind[PagEdgeKind["This"] = 4] = "This";
    PagEdgeKind[PagEdgeKind["Unknown"] = 5] = "Unknown";
    PagEdgeKind[PagEdgeKind["InterProceduralCopy"] = 6] = "InterProceduralCopy";
})(PagEdgeKind || (exports.PagEdgeKind = PagEdgeKind = {}));
class PagEdge extends BaseExplicitGraph_1.BaseEdge {
    constructor(n, d, k, s) {
        super(n, d, k);
        this.stmt = s;
    }
    getDotAttr() {
        switch (this.getKind()) {
            case PagEdgeKind.Address:
                return 'color=green';
            case PagEdgeKind.Copy:
                if (this.stmt?.getInvokeExpr() !== undefined || this.stmt instanceof Stmt_1.ArkReturnStmt) {
                    return 'color=black,style=dotted';
                }
                return 'color=black';
            case PagEdgeKind.Load:
                return 'color=red';
            case PagEdgeKind.Write:
                return 'color=blue';
            case PagEdgeKind.This:
                return 'color=orange';
            case PagEdgeKind.InterProceduralCopy:
                return 'color=purple,style=dashed';
            default:
                return 'color=black';
        }
    }
}
exports.PagEdge = PagEdge;
class AddrPagEdge extends PagEdge {
    constructor(n, d, s) {
        super(n, d, PagEdgeKind.Address, s);
    }
}
exports.AddrPagEdge = AddrPagEdge;
class CopyPagEdge extends PagEdge {
    constructor(n, d, s) {
        super(n, d, PagEdgeKind.Copy, s);
    }
}
exports.CopyPagEdge = CopyPagEdge;
class LoadPagEdge extends PagEdge {
    constructor(n, d, s) {
        super(n, d, PagEdgeKind.Copy, s);
    }
}
exports.LoadPagEdge = LoadPagEdge;
class WritePagEdge extends PagEdge {
    constructor(n, d, s) {
        super(n, d, PagEdgeKind.Write, s);
    }
}
exports.WritePagEdge = WritePagEdge;
class ThisPagEdge extends PagEdge {
    constructor(n, d, s) {
        super(n, d, PagEdgeKind.This, s);
    }
}
exports.ThisPagEdge = ThisPagEdge;
var PagNodeKind;
(function (PagNodeKind) {
    PagNodeKind[PagNodeKind["HeapObj"] = 0] = "HeapObj";
    PagNodeKind[PagNodeKind["LocalVar"] = 1] = "LocalVar";
    PagNodeKind[PagNodeKind["RefVar"] = 2] = "RefVar";
    PagNodeKind[PagNodeKind["Param"] = 3] = "Param";
    PagNodeKind[PagNodeKind["ThisRef"] = 4] = "ThisRef";
    PagNodeKind[PagNodeKind["Function"] = 5] = "Function";
    PagNodeKind[PagNodeKind["GlobalThis"] = 6] = "GlobalThis";
    PagNodeKind[PagNodeKind["ExportInfo"] = 7] = "ExportInfo";
})(PagNodeKind || (exports.PagNodeKind = PagNodeKind = {}));
class PagNode extends BaseExplicitGraph_1.BaseNode {
    constructor(id, cid = undefined, value, k, s) {
        super(id, k);
        this.cid = cid;
        this.value = value;
        this.stmt = s;
        let ptaConfig = PointerAnalysisConfig_1.PointerAnalysisConfig.getInstance();
        this.pointTo = new ptaConfig.ptsCollectionCtor();
    }
    getBasePt() {
        return this.basePt;
    }
    setBasePt(pt) {
        this.basePt = pt;
    }
    getCid() {
        if (this.cid === undefined) {
            throw new Error('cid is undefine');
        }
        return this.cid;
    }
    setCid(cid) {
        this.cid = cid;
    }
    setStmt(s) {
        this.stmt = s;
    }
    getStmt() {
        return this.stmt;
    }
    hasOutgoingCopyEdge() {
        return this.copyOutEdges.size !== 0;
    }
    getOutgoingCopyEdges() {
        return this.copyOutEdges;
    }
    getIncomingCopyEdges() {
        return this.copyInEdges;
    }
    getOutgoingLoadEdges() {
        return this.loadOutEdges;
    }
    getOutgoingWriteEdges() {
        return this.writeOutEdges;
    }
    getIncomingWriteEdges() {
        return this.writeInEdges;
    }
    getOutgoingThisEdges() {
        return this.thisOutEdges;
    }
    getIncomingThisEdges() {
        return this.thisInEdges;
    }
    addAddressInEdge(e) {
        this.addressInEdges === undefined ? (this.addressInEdges = new Set()) : undefined;
        this.addressInEdges.add(e);
        this.addIncomingEdge(e);
    }
    addAddressOutEdge(e) {
        this.addressOutEdges === undefined ? (this.addressOutEdges = new Set()) : undefined;
        this.addressOutEdges.add(e);
        this.addOutgoingEdge(e);
    }
    addCopyInEdge(e) {
        this.copyInEdges === undefined ? (this.copyInEdges = new Set()) : undefined;
        this.copyInEdges.add(e);
        this.addIncomingEdge(e);
    }
    addCopyOutEdge(e) {
        this.copyOutEdges === undefined ? (this.copyOutEdges = new Set()) : undefined;
        this.copyOutEdges.add(e);
        this.addOutgoingEdge(e);
    }
    addLoadInEdge(e) {
        this.loadInEdges === undefined ? (this.loadInEdges = new Set()) : undefined;
        this.loadInEdges.add(e);
        this.addIncomingEdge(e);
    }
    addLoadOutEdge(e) {
        this.loadOutEdges === undefined ? (this.loadOutEdges = new Set()) : undefined;
        this.loadOutEdges.add(e);
        this.addOutgoingEdge(e);
    }
    addWriteInEdge(e) {
        this.writeInEdges = this.writeInEdges ?? new Set();
        this.writeInEdges.add(e);
        this.addIncomingEdge(e);
    }
    addWriteOutEdge(e) {
        this.writeOutEdges = this.writeOutEdges ?? new Set();
        this.writeOutEdges.add(e);
        this.addOutgoingEdge(e);
    }
    addThisInEdge(e) {
        this.thisInEdges = this.thisInEdges ?? new Set();
        this.thisInEdges.add(e);
        this.addIncomingEdge(e);
    }
    addThisOutEdge(e) {
        this.thisOutEdges = this.thisOutEdges ?? new Set();
        this.thisOutEdges.add(e);
        this.addOutgoingEdge(e);
    }
    getValue() {
        return this.value;
    }
    getPointTo() {
        return this.pointTo;
    }
    addPointToElement(node) {
        this.pointTo.insert(node);
    }
    setPointTo(pts) {
        this.pointTo = pts;
    }
    getOutEdges() {
        return {
            AddressEdge: this.addressOutEdges,
            CopyEdge: this.copyOutEdges,
            LoadEdge: this.loadOutEdges,
            WriteEdge: this.writeOutEdges,
        };
    }
    getClonedFrom() {
        return this.clonedFrom;
    }
    setClonedFrom(id) {
        this.clonedFrom = id;
    }
    getDotAttr() {
        switch (this.getKind()) {
            case PagNodeKind.HeapObj:
            case PagNodeKind.Function:
            case PagNodeKind.GlobalThis:
                return 'shape=box3d';
            case PagNodeKind.LocalVar:
                return 'shape=box';
            case PagNodeKind.RefVar:
                return 'shape=component';
            case PagNodeKind.Param:
                return 'shape=box';
            case PagNodeKind.ExportInfo:
                return 'shape=tab,color=purple';
            case PagNodeKind.ThisRef:
                return 'shape=box,color=orange';
            default:
                return 'shape=box';
        }
    }
    getDotLabel() {
        let label;
        let param;
        label = PagNodeKind[this.getKind()];
        label = label + ` ID: ${this.getID()} Ctx: ${this.cid}`;
        if (this.basePt) {
            label = label + ` base:{${this.basePt}}`;
        }
        label = label + ` pts:{${Array.from(this.pointTo).join(',')}}`;
        if (this.getKind() === PagNodeKind.Param) {
            param = this.value;
            label = label + `\nParam#${param.getIndex()} ${param.toString()}`;
        }
        if (this.getKind() === PagNodeKind.ThisRef) {
            const thisRef = this.value;
            label = label + `\n${thisRef.toString()}`;
            const funcName = this.getFunctionNameFromThisRefNode();
            if (funcName) {
                label = label + `\n${funcName}()`;
            }
        }
        if (this.getKind() === PagNodeKind.Function) {
            const funcNode = this;
            label = label + ` thisPt:{${funcNode.getThisPt()}}`;
            const methodSig = funcNode.getMethod();
            if (methodSig) {
                const funcName = methodSig.getMethodSubSignature().getMethodName();
                label = label + `\nFunc: ${funcName}()`;
            }
        }
        if (this.stmt) {
            label = label + `\n${this.stmt.toString()}`;
            let method = this.stmt.getCfg()?.getDeclaringMethod().getSubSignature().toString();
            if (method) {
                label = label + '\n' + method;
            }
            label = label + ' ln: ' + this.stmt.getOriginPositionInfo().getLineNo();
        }
        else if (this.value) {
            label += `\n${this.value.toString()}`;
        }
        return label;
    }
    getFunctionNameFromThisRefNode() {
        const outgoingEdges = this.getOutgoingEdges();
        for (const edge of outgoingEdges) {
            const dstNode = edge.getDstNode();
            if (!dstNode) {
                continue;
            }
            const value = dstNode.getValue();
            if (!(value instanceof Local_1.Local)) {
                continue;
            }
            const local = value;
            if (local.getName() !== 'this') {
                continue;
            }
            const declaringStmt = local.getDeclaringStmt();
            if (!declaringStmt) {
                continue;
            }
            const method = declaringStmt.getCfg()?.getDeclaringMethod();
            if (!method) {
                continue;
            }
            return method.getName();
        }
        return undefined;
    }
}
exports.PagNode = PagNode;
class PagLocalNode extends PagNode {
    constructor(id, cid = undefined, value, stmt) {
        super(id, cid, value, PagNodeKind.LocalVar, stmt);
        this.storageLinked = false;
        this.sdkParam = false;
    }
    addRelatedDynCallSite(cs) {
        this.relatedDynamicCallSite = this.relatedDynamicCallSite ?? new Set();
        this.relatedDynamicCallSite.add(cs);
    }
    getRelatedDynCallSites() {
        return this.relatedDynamicCallSite ?? new Set();
    }
    addRelatedUnknownCallSite(cs) {
        this.relatedUnknownCallSite = this.relatedUnknownCallSite ?? new Set();
        this.relatedUnknownCallSite.add(cs);
    }
    getRelatedUnknownCallSites() {
        return this.relatedUnknownCallSite ?? new Set();
    }
    setStorageLink(storageType, propertyName) {
        this.storageLinked = true;
        this.storageType = storageType;
        this.propertyName = propertyName;
    }
    getStorage() {
        return {
            StorageType: this.storageType,
            PropertyName: this.propertyName,
        };
    }
    isStorageLinked() {
        return this.storageLinked;
    }
    setSdkParam() {
        this.sdkParam = true;
    }
    isSdkParam() {
        return this.sdkParam;
    }
}
exports.PagLocalNode = PagLocalNode;
class PagInstanceFieldNode extends PagNode {
    constructor(id, cid = undefined, instanceFieldRef, stmt) {
        super(id, cid, instanceFieldRef, PagNodeKind.RefVar, stmt);
    }
}
exports.PagInstanceFieldNode = PagInstanceFieldNode;
class PagStaticFieldNode extends PagNode {
    constructor(id, cid = undefined, staticFieldRef, stmt) {
        super(id, cid, staticFieldRef, PagNodeKind.RefVar, stmt);
    }
}
exports.PagStaticFieldNode = PagStaticFieldNode;
class PagThisRefNode extends PagNode {
    constructor(id, cid = undefined, thisRef) {
        super(id, cid, thisRef, PagNodeKind.ThisRef);
        this.pointToNode = [];
    }
    getThisPTNode() {
        return this.pointToNode;
    }
    addPTNode(ptNode) {
        this.pointToNode.push(ptNode);
    }
}
exports.PagThisRefNode = PagThisRefNode;
class PagArrayNode extends PagNode {
    constructor(id, cid = undefined, expr, stmt) {
        super(id, cid, expr, PagNodeKind.LocalVar, stmt);
        this.base = expr.getBase();
    }
}
exports.PagArrayNode = PagArrayNode;
class PagConstantNode extends PagNode {
    constructor(id, cid = undefined, constant, stmt) {
        super(id, cid, constant, PagNodeKind.LocalVar, stmt);
    }
}
exports.PagConstantNode = PagConstantNode;
/**
 * below is heapObj like Node
 */
class PagNewExprNode extends PagNode {
    constructor(id, cid = undefined, expr, stmt) {
        super(id, cid, expr, PagNodeKind.HeapObj, stmt);
    }
    addFieldNode(fieldSignature, nodeID) {
        if (!this.fieldNodes) {
            this.fieldNodes = new Map();
        }
        if (this.fieldNodes.has(fieldSignature.getFieldSignature().toString())) {
            return false;
        }
        this.fieldNodes.set(fieldSignature.getFieldSignature().toString(), nodeID);
        return true;
    }
    getFieldNode(fieldSignature) {
        if (!this.fieldNodes) {
            return undefined;
        }
        return this.fieldNodes.get(fieldSignature.getFieldSignature().toString());
    }
    getFieldNodes() {
        if (!this.fieldNodes) {
            return undefined;
        }
        return this.fieldNodes;
    }
}
exports.PagNewExprNode = PagNewExprNode;
class PagNewContainerExprNode extends PagNode {
    constructor(id, cid = undefined, expr, stmt) {
        super(id, cid, expr, PagNodeKind.HeapObj, stmt);
    }
    addElementNode(nodeID) {
        if (!this.elementNode) {
            this.elementNode = nodeID;
        }
        return true;
    }
    getElementNode() {
        if (this.elementNode) {
            return this.elementNode;
        }
        return undefined;
    }
}
exports.PagNewContainerExprNode = PagNewContainerExprNode;
class PagParamNode extends PagNode {
    constructor(id, cid = undefined, r, stmt) {
        super(id, cid, r, PagNodeKind.Param, stmt);
    }
}
exports.PagParamNode = PagParamNode;
class PagFuncNode extends PagNode {
    // TODO: may add obj interface
    constructor(id, cid = undefined, r, stmt, method, thisInstanceID) {
        super(id, cid, r, PagNodeKind.Function, stmt);
        this.argsOffset = 0;
        if (method) {
            this.methodSignature = method;
            this.methodType = (0, PTAUtils_1.getBuiltInApiType)(method);
        }
        if (thisInstanceID) {
            this.thisPt = thisInstanceID;
        }
    }
    setMethod(method) {
        this.methodSignature = method;
        this.methodType = (0, PTAUtils_1.getBuiltInApiType)(method);
    }
    getMethod() {
        return this.methodSignature;
    }
    setThisPt(thisPt) {
        this.thisPt = thisPt;
    }
    getThisPt() {
        return this.thisPt;
    }
    setCS(callSite) {
        this.originCallSite = callSite;
    }
    getCS() {
        return this.originCallSite;
    }
    setArgsOffset(offset) {
        this.argsOffset = offset;
    }
    getArgsOffset() {
        return this.argsOffset;
    }
    getMethodType() {
        return this.methodType;
    }
    setOriginCid(cid) {
        this.originCid = cid;
    }
    getOriginCid() {
        return this.originCid;
    }
}
exports.PagFuncNode = PagFuncNode;
/**
 * almost same as PagNewExprNode, used only for globalThis and its field reference
 */
class PagGlobalThisNode extends PagNode {
    constructor(id, cid = undefined, r, stmt) {
        super(id, cid, r, PagNodeKind.GlobalThis, stmt);
        this.fieldNodes = new Map();
    }
    addFieldNode(fieldSignature, nodeID) {
        if (this.fieldNodes.has(fieldSignature.getFieldSignature().toString())) {
            return false;
        }
        this.fieldNodes.set(fieldSignature.getFieldSignature().toString(), nodeID);
        return true;
    }
    getFieldNode(fieldSignature) {
        return this.fieldNodes.get(fieldSignature.getFieldSignature().toString());
    }
    getFieldNodes() {
        return this.fieldNodes;
    }
}
exports.PagGlobalThisNode = PagGlobalThisNode;
class Pag extends BaseExplicitGraph_1.BaseExplicitGraph {
    constructor() {
        super(...arguments);
        this.contextValueToIdMap = new Map();
        // contextBaseToIdMap will only be used in instance field
        // Value: instance field base value, NodeID: abstract nodes
        this.contextBaseToIdMap = new Map();
        // for reanalyze, will return new addr edges
        this.stashAddrEdge = new Set();
        this.addrEdge = new Set();
        this.clonedNodeMap = new Map();
    }
    getCG() {
        return this.cg;
    }
    /*
     * Clone a PagNode with same cid/value/stmt,
     * but different Node ID
     */
    getOrClonePagNode(src, basePt) {
        if (src.getBasePt() !== undefined) {
            throw new Error('This is a cloned ref node, can not be cloned again');
        }
        let cloneSet = this.clonedNodeMap.get(src.getID());
        if (!cloneSet) {
            cloneSet = new Map();
            this.clonedNodeMap.set(src.getID(), cloneSet);
        }
        else {
            let nodeID = cloneSet.get(basePt);
            if (nodeID) {
                return this.getNode(nodeID);
            }
        }
        // Not found
        let cloneNode = this.addPagNode(src.getCid(), src.getValue(), src.getStmt(), false);
        cloneNode.setClonedFrom(src.getID());
        cloneSet.set(basePt, cloneNode.getID());
        return cloneNode;
    }
    getOrClonePagFieldNode(src, basePt) {
        let baseNode = this.getNode(basePt);
        if (baseNode instanceof PagNewExprNode || baseNode instanceof PagGlobalThisNode) {
            // check if real field node has been created with basePT, using FieldSignature as key
            let existedNode = baseNode.getFieldNode(src.getValue());
            if (existedNode) {
                return this.getNode(existedNode);
            }
            let fieldNode = this.getOrClonePagNode(src, basePt);
            baseNode.addFieldNode(src.getValue(), fieldNode.getID());
            fieldNode.setBasePt(basePt);
            return fieldNode;
        }
        else if (baseNode instanceof PagNewContainerExprNode) {
            return this.handleContainerFieldAccess(baseNode, src, basePt);
        }
        else {
            logger.error(`Error clone field node ${src.getValue()}, baseNode type: ${baseNode?.constructor.name}`);
            return undefined;
        }
    }
    /**
     * Handle field access on container types (Array, Set, Map)
     * Distinguishes between element access and property access based on container type and field name
     * @param baseNode The container node (PagNewContainerExprNode)
     * @param src The abstract field node representing the access
     * @param basePt The pointer ID of the base container
     * @returns PagInstanceFieldNode for the access, or undefined if error
     */
    handleContainerFieldAccess(baseNode, src, basePt) {
        // Container types (Array, Set, Map) have two kinds of access:
        // 1. Element access (arr[0]) - should create element node via getOrClonePagContainerFieldNode
        // 2. Property access (arr.length) - should create field node as regular object fields
        const fieldRef = src.getValue();
        const fieldName = fieldRef.getFieldSignature().getFieldName();
        const base = fieldRef.getBase();
        // Get container type from the node's value
        // PagNewContainerExprNode can contain either ArkNewExpr or ArkNewArrayExpr
        const containerValue = baseNode.getValue();
        let containerClassSig = '';
        if (containerValue instanceof Expr_1.ArkNewExpr) {
            // Regular container object: new Map(), new Set()
            containerClassSig = containerValue.getClassType().getClassSignature().toString();
        }
        else if (containerValue instanceof Expr_1.ArkNewArrayExpr) {
            // Array created via array literal: [1, 2, 3]
            containerClassSig = 'lib.es5.d.ts: Array';
        }
        else {
            // Fallback: check base type
            const baseType = base.getType();
            containerClassSig = baseType.toString();
        }
        // Determine if this is element access or property access based on container type
        let isElementAccess = false;
        let containerType = '';
        if (containerClassSig.includes('lib.es5.d.ts: Array') || containerClassSig.includes('ArrayType')) {
            containerType = 'Array';
            // Array: exclude known properties (length, push, pop, etc.)
            // Everything else should be treated as element access
            const arrayProperties = ['length', 'push', 'pop', 'shift', 'unshift', 'splice',
                'slice', 'concat', 'join', 'reverse', 'sort', 'indexOf',
                'lastIndexOf', 'forEach', 'map', 'filter', 'reduce',
                'reduceRight', 'every', 'some', 'find', 'findIndex'];
            isElementAccess = !arrayProperties.includes(fieldName);
        }
        else if (containerClassSig.includes('lib.es2015.collection.d.ts: Map')) {
            containerType = 'Map';
            // Map: 'field' is the virtual field name for element access
            isElementAccess = (fieldName === 'field');
        }
        else if (containerClassSig.includes('lib.es2015.collection.d.ts: Set')) {
            containerType = 'Set';
            // Set: 'field' is the virtual field name for element access
            isElementAccess = (fieldName === 'field');
        }
        if (isElementAccess && containerType) {
            // This is element access (e.g., arr[i], map.get(key), set elements)
            // IMPORTANT: In some cases, the type of arr.i may be unknow,
            //            so this is actually ArrayRef rather than InstanceFieldRef
            // Redirect to container element node handling
            logger.debug(`[PTA]: Detected element access on ${containerType}: ${fieldRef}, redirecting to container element node`);
            return this.getOrClonePagContainerFieldNode(basePt, base, containerType);
        }
        else {
            // This is property access (e.g., arr.length)
            // Create field node without caching in baseNode.fieldNodes
            logger.debug(`[PTA]: Detected property access on ${containerType || 'container'}: ${fieldName}, treating as regular field`);
            let fieldNode = this.getOrClonePagNode(src, basePt);
            fieldNode.setBasePt(basePt);
            return fieldNode;
        }
    }
    getOrClonePagContainerFieldNode(basePt, base, className) {
        let baseNode = this.getNode(basePt);
        if (baseNode instanceof PagNewContainerExprNode) {
            // check if Array Ref real node has been created or not, if not: create a real Array Ref node
            let existedNode = baseNode.getElementNode();
            let fieldNode;
            let fieldRef;
            if (existedNode) {
                return this.getNode(existedNode);
            }
            switch (className) {
                case 'Array':
                    fieldRef = new Ref_1.ArkInstanceFieldRef(base, PTAUtils_1.ARRAY_FIELD_SIGNATURE);
                    break;
                case 'Set':
                    fieldRef = new Ref_1.ArkInstanceFieldRef(base, PTAUtils_1.SET_FIELD_SIGNATURE);
                    break;
                case 'Map':
                    fieldRef = new Ref_1.ArkInstanceFieldRef(base, PTAUtils_1.MAP_FIELD_SIGNATURE);
                    break;
                default:
                    logger.error(`Error clone array field node ${className}`);
                    return undefined;
            }
            // Use special container element context ID (CONTAINER_ELEMENT_CID = -2)
            // This allows:
            // 1. Same container object's elements to be shared across all contexts (via basePt)
            // 2. Different container objects NOT to share elements (via different basePt)
            // 3. Avoid global abstract containers (cid=0) from polluting concrete containers
            fieldNode = this.addPagNode(Context_1.CONTAINER_ELEMENT_CID, fieldRef);
            baseNode.addElementNode(fieldNode.getID());
            fieldNode.setBasePt(basePt);
            return fieldNode;
        }
        else if (baseNode instanceof PagNewExprNode) {
            // In some cases, the value of a variable of array type may not be an explicit array object.
            // For example, it could be a return value of a function (assuming that the call depth has
            // exceeded the k-limit).
            // In such situation, the `baseNode` will be a PagNewExprNode instead of a PagNewContainerExprNode,
            // and a warning will be raised.
            logger.warn(`[PTA]: Trying to clone an array from a PagNewExprNode instead of a PagNewContainerExprNode`);
        }
        else {
            throw new Error(`Error clone array field node ${baseNode.getValue()}`);
        }
        return undefined;
    }
    getOrClonePagFuncNode(basePt) {
        let baseNode = this.getNode(basePt);
        if (baseNode instanceof PagFuncNode) {
            let clonedFuncNode = this.getOrClonePagNode(baseNode, basePt);
            return clonedFuncNode;
        }
        else {
            logger.error(`Error clone func node ${baseNode.getValue()}`);
            return undefined;
        }
    }
    addPagNode(cid, value, stmt, refresh = true) {
        let id = this.nodeNum + 1;
        let pagNode;
        if (value instanceof Local_1.Local) {
            pagNode = this.handleLocalNode(id, cid, value, stmt);
        }
        else if (value instanceof Ref_1.ArkInstanceFieldRef) {
            pagNode = this.handleInstanceFieldNode(id, cid, value, stmt);
        }
        else if (value instanceof Ref_1.ArkStaticFieldRef) {
            pagNode = this.handleStaticFieldNode(id, cid, value, stmt);
        }
        else if (value instanceof Ref_1.ArkArrayRef) {
            pagNode = new PagArrayNode(id, cid, value, stmt);
        }
        else if (value instanceof Expr_1.ArkNewExpr) {
            pagNode = this.handleNewExprNode(id, cid, value, stmt);
        }
        else if (value instanceof Expr_1.ArkNewArrayExpr) {
            pagNode = new PagNewContainerExprNode(id, cid, value, stmt);
        }
        else if (value instanceof Ref_1.ArkParameterRef) {
            pagNode = new PagParamNode(id, cid, value, stmt);
        }
        else if (value instanceof Ref_1.ArkThisRef) {
            pagNode = new PagThisRefNode(id, cid, value);
        }
        else if (value instanceof Constant_1.Constant) {
            pagNode = new PagConstantNode(id, cid, value, stmt);
        }
        else {
            throw new Error('unsupported Value type ' + value.getType().toString());
        }
        this.addNode(pagNode);
        this.addContextOrExportInfoMap(refresh, cid, id, value, pagNode, stmt);
        return pagNode;
    }
    handleLocalNode(id, cid, value, stmt) {
        const valueType = value.getType();
        if (valueType instanceof Type_1.FunctionType && value.getDeclaringStmt() === null) {
            return new PagFuncNode(id, cid, value, stmt, valueType.getMethodSignature());
        }
        else if (value.getName() === TSConst_1.GLOBAL_THIS_NAME && value.getDeclaringStmt() == null) {
            return new PagGlobalThisNode(id, -1, value);
        }
        else {
            return new PagLocalNode(id, cid, value, stmt);
        }
    }
    handleInstanceFieldNode(id, cid, value, stmt) {
        return this.createFieldNode(id, cid, value, stmt);
    }
    handleStaticFieldNode(id, cid, value, stmt) {
        return this.createFieldNode(id, cid, value, stmt);
    }
    createFieldNode(id, cid, value, stmt) {
        if (value.getType() instanceof Type_1.FunctionType) {
            return new PagFuncNode(id, cid, value, stmt, value.getType().getMethodSignature());
        }
        else {
            return value instanceof Ref_1.ArkStaticFieldRef ? new PagStaticFieldNode(id, cid, value, stmt) : new PagInstanceFieldNode(id, cid, value, stmt);
        }
    }
    handleNewExprNode(id, cid, value, stmt) {
        const classSignature = value.getClassType().getClassSignature();
        if ((0, PTAUtils_1.IsCollectionClass)(classSignature)) {
            return new PagNewContainerExprNode(id, cid, value, stmt);
        }
        else {
            return new PagNewExprNode(id, cid, value, stmt);
        }
    }
    addContextOrExportInfoMap(refresh, cid, id, value, pagNode, stmt) {
        if (!(value instanceof ArkExport_1.ExportInfo)) {
            this.addContextMap(refresh, cid, id, value, stmt, pagNode);
        }
        else {
            this.addExportInfoMap(id, value);
        }
    }
    addExportInfoMap(id, v) {
        this.ExportInfoToIdMap = this.ExportInfoToIdMap ?? new Map();
        this.ExportInfoToIdMap.set(v, id);
    }
    addContextMap(refresh, cid, id, value, stmt, pagNode) {
        if (!refresh) {
            return;
        }
        let ctx2NdMap = this.contextValueToIdMap.get(value);
        if (!ctx2NdMap) {
            ctx2NdMap = new Map();
            this.contextValueToIdMap.set(value, ctx2NdMap);
        }
        ctx2NdMap.set(cid, id);
        if (!(value instanceof Ref_1.ArkInstanceFieldRef || value instanceof Ref_1.ArkArrayRef)) {
            return;
        }
        let base = value.getBase();
        //TODO: remove below once this Local is not uniq in %instInit is fix
        if (base instanceof Local_1.Local && base.getName() === 'this') {
            stmt
                ?.getCfg()
                ?.getStmts()
                .forEach(s => {
                if (s instanceof Stmt_1.ArkAssignStmt && s.getLeftOp() instanceof Local_1.Local && s.getLeftOp().getName() === 'this') {
                    base = s.getLeftOp();
                    return;
                }
            });
        }
        let ctxMap = this.contextBaseToIdMap.get(base);
        if (ctxMap === undefined) {
            ctxMap = new Map();
            ctxMap.set(cid, [pagNode.getID()]);
        }
        else {
            let nodes = ctxMap.get(cid);
            if (nodes === undefined) {
                nodes = [pagNode.getID()];
            }
            else {
                nodes.push(pagNode.getID());
            }
            ctxMap.set(cid, nodes);
        }
        this.contextBaseToIdMap.set(base, ctxMap);
    }
    getOrNewThisLocalNode(cid, ptNode, value, s) {
        if (ptNode !== -1) {
            return this.getNode(ptNode);
        }
        else {
            return this.getOrNewNode(cid, value, s);
        }
    }
    hasExportNode(v) {
        this.ExportInfoToIdMap = this.ExportInfoToIdMap ?? new Map();
        return this.ExportInfoToIdMap.get(v);
    }
    hasCtxNode(cid, v) {
        let ctx2nd = this.contextValueToIdMap.get(v);
        if (!ctx2nd) {
            return undefined;
        }
        let ndId = ctx2nd.get(cid);
        if (!ndId) {
            return undefined;
        }
        return ndId;
    }
    hasCtxRetNode(cid, v) {
        let ctx2nd = this.contextValueToIdMap.get(v);
        if (!ctx2nd) {
            return undefined;
        }
        let ndId = ctx2nd.get(cid);
        if (!ndId) {
            return undefined;
        }
        return ndId;
    }
    getOrNewNode(cid, v, s) {
        let nodeId;
        // Value
        if (!(v instanceof ArkExport_1.ExportInfo)) {
            nodeId = this.hasCtxNode(cid, v);
        }
        else {
            // ExportInfo
            nodeId = this.hasExportNode(v);
        }
        if (nodeId !== undefined) {
            return this.getNode(nodeId);
        }
        return this.addPagNode(cid, v, s);
    }
    getNodesByValue(v) {
        return this.contextValueToIdMap.get(v);
    }
    getNodesByBaseValue(v) {
        return this.contextBaseToIdMap.get(v);
    }
    addPagEdge(src, dst, kind, stmt) {
        // TODO: check if the edge already existing
        let edge = new PagEdge(src, dst, kind, stmt);
        if (this.ifEdgeExisting(edge)) {
            return false;
        }
        switch (kind) {
            case PagEdgeKind.Copy:
            case PagEdgeKind.InterProceduralCopy:
                src.addCopyOutEdge(edge);
                dst.addCopyInEdge(edge);
                if (src instanceof PagFuncNode || src instanceof PagGlobalThisNode || src instanceof PagNewExprNode || src instanceof PagNewContainerExprNode) {
                    this.addrEdge.add(edge);
                    this.stashAddrEdge.add(edge);
                }
                break;
            case PagEdgeKind.Address:
                src.addAddressOutEdge(edge);
                dst.addAddressInEdge(edge);
                this.addrEdge.add(edge);
                this.stashAddrEdge.add(edge);
                break;
            case PagEdgeKind.Write:
                src.addWriteOutEdge(edge);
                dst.addWriteInEdge(edge);
                break;
            case PagEdgeKind.Load:
                src.addLoadOutEdge(edge);
                dst.addLoadInEdge(edge);
                break;
            case PagEdgeKind.This:
                src.addThisOutEdge(edge);
                dst.addThisInEdge(edge);
                break;
            default:
        }
        this.edgeNum++;
        return true;
    }
    getAddrEdges() {
        return this.stashAddrEdge;
    }
    resetAddrEdges() {
        this.stashAddrEdge.clear();
    }
    getGraphName() {
        return 'PAG';
    }
    dump(name) {
        let printer = new GraphPrinter_1.GraphPrinter(this);
        PrinterBuilder_1.PrinterBuilder.dump(printer, name);
    }
}
exports.Pag = Pag;
class FuncPag {
    getInternalEdges() {
        return this.internalEdges;
    }
    addNormalCallSite(cs) {
        this.normalCallSites = this.normalCallSites ?? new Set();
        this.normalCallSites.add(cs);
    }
    getNormalCallSites() {
        this.normalCallSites = this.normalCallSites ?? new Set();
        return this.normalCallSites;
    }
    addDynamicCallSite(cs) {
        this.dynamicCallSites = this.dynamicCallSites ?? new Set();
        this.dynamicCallSites.add(cs);
    }
    getDynamicCallSites() {
        this.dynamicCallSites = this.dynamicCallSites ?? new Set();
        return this.dynamicCallSites;
    }
    addUnknownCallSite(cs) {
        this.unknownCallSites = this.unknownCallSites ?? new Set();
        this.unknownCallSites.add(cs);
    }
    getUnknownCallSites() {
        this.unknownCallSites = this.unknownCallSites ?? new Set();
        return this.unknownCallSites;
    }
    addInternalEdge(stmt, k) {
        this.internalEdges === undefined ? (this.internalEdges = new Set()) : undefined;
        let lhOp = stmt.getLeftOp();
        let rhOp = stmt.getRightOp();
        if (rhOp instanceof Constant_1.Constant) {
            return false;
        }
        let iEdge = {
            src: rhOp,
            dst: lhOp,
            kind: k,
            stmt: stmt,
        };
        this.internalEdges.add(iEdge);
        return true;
    }
}
exports.FuncPag = FuncPag;
class InterFuncPag {
    constructor() {
        this.interFuncEdges = new Set();
    }
    getInterProceduralEdges() {
        return this.interFuncEdges;
    }
    addToInterProceduralEdgeSet(e) {
        this.interFuncEdges.add(e);
    }
}
exports.InterFuncPag = InterFuncPag;
//# sourceMappingURL=Pag.js.map