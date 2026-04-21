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
exports.FunctionPlugin = void 0;
const Constant_1 = require("../../../core/base/Constant");
const Local_1 = require("../../../core/base/Local");
const Stmt_1 = require("../../../core/base/Stmt");
const Type_1 = require("../../../core/base/Type");
const Pag_1 = require("../Pag");
const PagBuilder_1 = require("../PagBuilder");
const PTAUtils_1 = require("../PTAUtils");
/**
 * FunctionPlugin processes Function.call, Function.apply, Function.bind.
 */
class FunctionPlugin {
    constructor(pag, pagBuilder, cg) {
        this.pag = pag;
        this.pagBuilder = pagBuilder;
        this.cg = cg;
    }
    getName() {
        return 'FunctionPlugin';
    }
    canHandle(cs, cgNode) {
        let ivkExpr = cs.callStmt.getInvokeExpr();
        const methodType = (0, PTAUtils_1.getBuiltInApiType)(ivkExpr.getMethodSignature());
        return methodType === PTAUtils_1.BuiltApiType.FunctionCall ||
            methodType === PTAUtils_1.BuiltApiType.FunctionApply ||
            methodType === PTAUtils_1.BuiltApiType.FunctionBind;
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
        let ivkExpr = cs.callStmt.getInvokeExpr();
        const methodType = (0, PTAUtils_1.getBuiltInApiType)(ivkExpr.getMethodSignature());
        const calleeCid = this.pagBuilder.getContextSelector().selectContext(cid, cs, basePTNode, calleeFuncID);
        // TODO: call and apply can return.
        switch (methodType) {
            case PTAUtils_1.BuiltApiType.FunctionCall:
                /**
                 * set this and param
                 * function.call(thisArg, arg1, arg2, ...)
                 */
                this.handleFunctionCall(cs, cid, calleeCid, calleeMethod, srcNodes);
                break;
            case PTAUtils_1.BuiltApiType.FunctionApply:
                /**
                 * set this, resolve array param
                 * function.apply(thisArg, [argsArray])
                 */
                this.handleFunctionApply(cs, cid, calleeCid, calleeMethod, srcNodes);
                break;
            case PTAUtils_1.BuiltApiType.FunctionBind:
                /**
                 * clone the function node and add the this pointer, origin callSite, args offset to it
                 * let f = function.bind(thisArg, arg1, arg2, ...)
                 * f();
                 */
                this.handleFunctionBind(cs, cid, basePTNode, srcNodes);
                break;
            default:
        }
        return srcNodes;
    }
    handleFunctionCall(staticCS, cid, calleeCid, realCallee, srcNodes) {
        this.pagBuilder.buildFuncPagAndAddToWorklist(new PagBuilder_1.CSFuncID(calleeCid, staticCS.calleeFuncID));
        srcNodes.push(...this.pagBuilder.addCallParamPagEdge(realCallee, staticCS.args, staticCS, cid, calleeCid, 1));
        this.addThisEdge(staticCS, cid, realCallee, srcNodes, calleeCid);
    }
    handleFunctionApply(staticCS, cid, calleeCid, realCallee, srcNodes) {
        this.pagBuilder.buildFuncPagAndAddToWorklist(new PagBuilder_1.CSFuncID(calleeCid, staticCS.calleeFuncID));
        let callerMethod = this.cg.getArkMethodByFuncID(staticCS.callerFuncID);
        if (!callerMethod) {
            throw new Error('Cannot get caller method');
        }
        let argsRealValues = this.transferArrayValues(staticCS.args[1]);
        srcNodes.push(...this.pagBuilder.addCallParamPagEdge(realCallee, argsRealValues, staticCS, cid, calleeCid, 0));
        this.addThisEdge(staticCS, cid, realCallee, srcNodes, calleeCid);
    }
    handleFunctionBind(staticCS, cid, baseClassPTNode, srcNodes) {
        let srcNode = this.pag.getOrClonePagFuncNode(baseClassPTNode);
        if (!srcNode) {
            return;
        }
        this.setFunctionThisPt(staticCS, srcNode, cid);
        let dstNode = this.pagBuilder.getOrNewPagNode(cid, staticCS.callStmt.getLeftOp());
        this.pag.addPagEdge(srcNode, dstNode, Pag_1.PagEdgeKind.Copy, staticCS.callStmt);
        srcNode.setCS(staticCS);
        srcNode.setArgsOffset(1);
        srcNode.setOriginCid(cid);
    }
    transferArrayValues(arrayLocal) {
        if (!(arrayLocal instanceof Local_1.Local) || !(arrayLocal.getType() instanceof Type_1.ArrayType)) {
            return [];
        }
        /**
         * TODO: get array element values
         * need to resolve multi dimension array
         */
        const usedValuesInArray = arrayLocal.getUsedStmts().flatMap(stmt => {
            if (stmt instanceof Stmt_1.ArkAssignStmt) {
                const rightOp = stmt.getRightOp();
                if (rightOp instanceof Local_1.Local) {
                    return rightOp;
                }
            }
            return [];
        });
        return usedValuesInArray;
    }
    setFunctionThisPt(staticCS, srcNode, cid) {
        let thisLocal = staticCS.args[0];
        if (!(thisLocal instanceof Local_1.Local)) {
            return;
        }
        let thisInstanceLocal = this.pagBuilder.getRealThisLocal(thisLocal, staticCS.callerFuncID);
        let baseThisNode = this.pag.getOrNewNode(cid, thisInstanceLocal);
        for (let pt of baseThisNode.getPointTo()) {
            srcNode.setThisPt(pt);
        }
    }
    addThisEdge(staticCS, cid, realCallee, srcNodes, calleeCid) {
        if (!(staticCS.args[0] instanceof Constant_1.NullConstant) && !realCallee.isStatic()) {
            let srcNodeID = this.pagBuilder.addThisRefCallEdge(cid, staticCS.args[0], realCallee, calleeCid, staticCS.callerFuncID);
            if (srcNodeID !== -1) {
                srcNodes.push(srcNodeID);
            }
        }
    }
}
exports.FunctionPlugin = FunctionPlugin;
