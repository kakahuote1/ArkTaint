"use strict";
/*
 * Copyright (c) 2025 Huawei Device Co., Ltd.
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
exports.WorkerPlugin = void 0;
const __1 = require("../../..");
const Constant_1 = require("../../../core/base/Constant");
const Local_1 = require("../../../core/base/Local");
const Ref_1 = require("../../../core/base/Ref");
const Stmt_1 = require("../../../core/base/Stmt");
const Const_1 = require("../../../core/common/Const");
const ContextSelector_1 = require("../context/ContextSelector");
const Pag_1 = require("../Pag");
const PagBuilder_1 = require("../PagBuilder");
class WorkerPlugin {
    constructor(pag, pagBuilder, cg) {
        this.workerObj2CGNodeMap = new Map();
        this.pag = pag;
        this.pagBuilder = pagBuilder;
        this.cg = cg;
    }
    getName() {
        return 'WorkerPlugin';
    }
    canHandle(cs, cgNode) {
        var _a;
        let namespacename = (_a = cgNode.getMethod().getDeclaringClassSignature().getDeclaringNamespaceSignature()) === null || _a === void 0 ? void 0 : _a.getNamespaceName();
        return namespacename === 'worker';
    }
    processCallSite(cs, cid, basePTNode) {
        let srcNodes = [];
        let calleeFuncID = cs.getCalleeFuncID();
        if (!calleeFuncID) {
            return srcNodes;
        }
        const calleeMethod = this.cg.getArkMethodByFuncID(calleeFuncID);
        if (!calleeMethod) {
            return srcNodes;
        }
        let methodname = calleeMethod.getSubSignature().getMethodName();
        if (methodname === Const_1.CONSTRUCTORFUCNNAME) {
            this.addWorkerObj2CGNodeMap(cs);
        }
        if (methodname === Const_1.POSTMESSAGEFUNCNAME || methodname === Const_1.POSTMESSAGEWITHSHAREDSENDABLEFUNCNAME) {
            this.addWorkerPagCallEdge(cs, cid, srcNodes);
        }
        return srcNodes;
    }
    addWorkerPagCallEdge(cs, callerCid, srcNodes) {
        let myworker = cs.callStmt.getInvokeExpr().getBase();
        let nodes = this.pag.getNodesByValue(myworker);
        let pointto = new Set();
        if (nodes === undefined) {
            return;
        }
        for (let node of nodes) {
            if (node[0] !== callerCid) {
                continue;
            }
            let ptcollection = this.pag.getNode(node[1]).getPointTo();
            for (let id of ptcollection) {
                pointto.add(this.pag.getNode(id));
            }
        }
        for (let obj of pointto) {
            let cgnode = this.workerObj2CGNodeMap.get(obj.getStmt().getLeftOp());
            if (cgnode === undefined) {
                continue;
            }
            this.addPostMessagePagCallEdge(cs, callerCid, cgnode.getID(), srcNodes);
        }
        return;
    }
    addPostMessagePagCallEdge(cs, callerCid, calleeFuncID, srcNodes) {
        var _a;
        let cgnode = this.cg.getNode(calleeFuncID);
        let calleeMethod = this.cg.getArkMethodByFuncID(cgnode.getID());
        if (calleeMethod === null) {
            return;
        }
        let calleeCid = this.pagBuilder.getContextSelector().selectContext(callerCid, cs, ContextSelector_1.emptyID, cgnode.getID());
        this.pagBuilder.buildFuncPagAndAddToWorklist(new PagBuilder_1.CSFuncID(calleeCid, cgnode.getID()));
        let params = calleeMethod.getCfg().getStmts()
            .filter(stmt => stmt instanceof Stmt_1.ArkAssignStmt && stmt.getRightOp() instanceof Ref_1.ArkParameterRef)
            .map(stmt => stmt.getRightOp());
        (_a = calleeMethod.getBody()) === null || _a === void 0 ? void 0 : _a.getLocals().forEach((local) => {
            if (local.getDeclaringStmt() instanceof Stmt_1.ArkAssignStmt && local.getDeclaringStmt().getRightOp() === params[0]) {
                // find the local corresponding to the first parameter
                this.ProcessPostMessagePagCallEdge(cs, callerCid, calleeCid, local, srcNodes);
            }
        });
        return;
    }
    ProcessPostMessagePagCallEdge(cs, callerCid, calleeCid, local, srcNodes) {
        let usedstmts = local.getUsedStmts().filter(usedstmt => usedstmt instanceof Stmt_1.ArkAssignStmt && usedstmt.getRightOp() instanceof Ref_1.ArkInstanceFieldRef);
        for (let usedstmt of usedstmts) {
            let fieldref = usedstmt.getRightOp();
            // find the fieldref whose fieldname is 'data', then add pag edge between the argument and the leftop of the assignstmt
            // of the fieldref
            if (fieldref.getBase() === local && fieldref.getFieldName() === 'data' && cs.args !== undefined && cs.args[0] instanceof Local_1.Local) {
                let srcPagNode = this.pagBuilder.getOrNewPagNode(callerCid, cs.args[0], cs.callStmt);
                let dstPagNode = this.pagBuilder.getOrNewPagNode(calleeCid, usedstmt.getLeftOp(), cs.callStmt);
                this.pag.addPagEdge(srcPagNode, dstPagNode, Pag_1.PagEdgeKind.Copy, cs.callStmt);
                srcNodes.push(srcPagNode.getID());
            }
        }
        return;
    }
    addWorkerObj2CGNodeMap(cs) {
        // Obtain the function that the worker sub-thread is going to execute through the file path.
        let callstmt = cs.callStmt;
        callstmt.getCfg().getDeclaringMethod().getDeclaringArkClass().getDeclaringArkFile().getScene();
        let invokeExpr = cs.callStmt.getInvokeExpr();
        if (cs.args === undefined) {
            return;
        }
        if (cs.args[0] instanceof Constant_1.StringConstant) {
            let workerfile = this.getFileByPath(callstmt, cs.args[0]);
            if (workerfile === null) {
                return;
            }
            let defaultArkMethod = workerfile.getDefaultClass().getDefaultArkMethod();
            if (defaultArkMethod === null) {
                return;
            }
            let cfg = defaultArkMethod.getCfg();
            if (cfg === undefined) {
                return;
            }
            let stmts = cfg.getStmts();
            for (let stmt of stmts) {
                // Find the assignment statement where the onmessage function is assigned to the worker object.
                if (!(stmt instanceof Stmt_1.ArkAssignStmt)) {
                    continue;
                }
                if (stmt.getLeftOp() instanceof Ref_1.ArkInstanceFieldRef && stmt.getLeftOp().getFieldName() === Const_1.ONMESSAGEFUNCNAME) {
                    let cgnode = this.cg.getCallGraphNodeByMethod(stmt.getRightOp().getType().getMethodSignature());
                    this.workerObj2CGNodeMap.set(invokeExpr.getBase(), cgnode);
                }
            }
        }
        return;
    }
    getWorkerObj2CGNodeMap() {
        return this.workerObj2CGNodeMap;
    }
    getFileByPath(callstmt, filePath) {
        let declaringarkfile = callstmt.getCfg().getDeclaringMethod().getDeclaringArkClass().getDeclaringArkFile();
        const scene = declaringarkfile.getScene();
        let filepath = filePath.toString().replace('../', '').replace('./', '').replace("'", '').replace("'", '');
        filepath = filepath.substring(filepath.indexOf('ets'));
        if (/\.e?ts$/.test(filepath)) {
            const fileSignature = new __1.FileSignature(declaringarkfile.getFileSignature().getProjectName(), filepath);
            return scene.getFile(fileSignature);
        }
        return null;
    }
}
exports.WorkerPlugin = WorkerPlugin;
