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
exports.TaskPoolPlugin = void 0;
const Constant_1 = require("../../../core/base/Constant");
const Expr_1 = require("../../../core/base/Expr");
const Local_1 = require("../../../core/base/Local");
const Stmt_1 = require("../../../core/base/Stmt");
const Type_1 = require("../../../core/base/Type");
const Const_1 = require("../../../core/common/Const");
const Pag_1 = require("../Pag");
const taskpoolMethodNames = new Set([
    'execute',
    'executeDelayed',
    'executePeriodically',
    'addTask',
    'constructor'
]);
class TaskPoolPlugin {
    constructor(pag, pagBuilder, cg) {
        this.pag = pag;
        this.pagBuilder = pagBuilder;
        this.cg = cg;
        this.sdkMethodReturnValueMap = new Map();
        this.methodParamValueMap = new Map();
        this.fakeSdkMethodParamDeclaringStmt = new Stmt_1.ArkAssignStmt(new Local_1.Local(''), new Local_1.Local(''));
        this.taskObj2ConstructorStmtMap = new Map();
        this.taskObj2CGNodeMap = new Map();
    }
    getName() {
        return 'TaskPoolPlugin';
    }
    canHandle(cs, cgNode) {
        var _a;
        // if namespace is 'taskpool', then can handle
        let namespacename = (_a = cgNode.getMethod().getDeclaringClassSignature().getDeclaringNamespaceSignature()) === null || _a === void 0 ? void 0 : _a.getNamespaceName();
        return namespacename === 'taskpool';
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
        const calleeCid = this.pagBuilder.getContextSelector().selectContext(cid, cs, basePTNode, calleeFuncID);
        if (methodname === Const_1.CONSTRUCTORFUCNNAME && cs.args !== undefined) {
            // match the constructor function so that update the taskObj2CGNodeMap
            for (let i = 0; i < cs.args.length; i++) {
                if (cs.args[i] instanceof Local_1.Local && cs.args[i].getType() instanceof Type_1.FunctionType) {
                    this.addTaskObj2CGNodeMap(cs, i);
                    break;
                }
            }
        }
        if (taskpoolMethodNames.has(methodname) && cs.args !== undefined) {
            // transfer the param function pag to the task thread function pag
            for (let i = 0; i < cs.args.length; i++) {
                if (cs.args[i] instanceof Local_1.Local && cs.args[i].getType() instanceof Type_1.FunctionType) {
                    this.addTaskPoolMethodPagCallEdge(cs, cid, calleeCid, srcNodes, i);
                    break;
                }
            }
        }
        return srcNodes;
    }
    addTaskPoolMethodPagCallEdge(cs, callerCid, calleeCid, srcNodes, index) {
        let calleeFuncID = cs.getCalleeFuncID();
        if (!calleeFuncID) {
            return;
        }
        let calleeNode = this.cg.getNode(calleeFuncID);
        let calleeMethod = this.cg.getArkMethodByFuncID(calleeFuncID);
        if (!calleeMethod) {
            return;
        }
        if (!this.methodParamValueMap.has(calleeNode.getID())) {
            this.buildSDKFuncPag(calleeNode.getID(), calleeMethod);
        }
        this.addSDKMethodReturnPagEdge(cs, callerCid, calleeCid, calleeMethod, srcNodes);
        this.addTaskPoolMethodParamPagEdge(cs, callerCid, calleeCid, calleeNode.getID(), srcNodes, index);
        return;
    }
    /**
     * will not create real funcPag, only create param values
     */
    buildSDKFuncPag(funcID, sdkMethod) {
        let paramArr = this.createDummyParamValue(sdkMethod);
        this.methodParamValueMap.set(funcID, paramArr);
    }
    createDummyParamValue(sdkMethod) {
        let args = sdkMethod.getParameters();
        let paramArr = [];
        if (!args) {
            return paramArr;
        }
        // Local
        args.forEach((arg) => {
            let argInstance = new Local_1.Local(arg.getName(), arg.getType());
            argInstance.setDeclaringStmt(this.fakeSdkMethodParamDeclaringStmt);
            paramArr.push(argInstance);
        });
        return paramArr;
    }
    addSDKMethodReturnPagEdge(cs, callerCid, calleeCid, calleeMethod, srcNodes) {
        let returnType = calleeMethod.getReturnType();
        if (!(returnType instanceof Type_1.ClassType) || !(cs.callStmt instanceof Stmt_1.ArkAssignStmt)) {
            return;
        }
        // check fake heap object exists or not
        let cidMap = this.sdkMethodReturnValueMap.get(calleeMethod);
        if (!cidMap) {
            cidMap = new Map();
        }
        let newExpr = cidMap.get(calleeCid);
        if (!newExpr && returnType instanceof Type_1.ClassType) {
            newExpr = new Expr_1.ArkNewExpr(returnType);
        }
        if (newExpr === undefined) {
            return;
        }
        cidMap.set(calleeCid, newExpr);
        this.sdkMethodReturnValueMap.set(calleeMethod, cidMap);
        let srcPagNode = this.pagBuilder.getOrNewPagNode(calleeCid, newExpr);
        let dstPagNode = this.pagBuilder.getOrNewPagNode(callerCid, cs.callStmt.getLeftOp(), cs.callStmt);
        this.pag.addPagEdge(srcPagNode, dstPagNode, Pag_1.PagEdgeKind.Address, cs.callStmt);
        srcNodes.push(srcPagNode.getID());
        return;
    }
    addTaskPoolMethodParamPagEdge(cs, callerCid, calleeCid, funcID, srcNodes, index) {
        var _a;
        let paramValue = (_a = this.methodParamValueMap.get(funcID)) === null || _a === void 0 ? void 0 : _a[0];
        if (paramValue === undefined || cs.args === undefined) {
            return;
        }
        let srcPagNode = this.pagBuilder.getOrNewPagNode(callerCid, cs.args[index], cs.callStmt);
        let dstPagNode = this.pagBuilder.getOrNewPagNode(calleeCid, paramValue, cs.callStmt);
        let args = cs.args.slice(index + 1);
        if (dstPagNode instanceof Pag_1.PagLocalNode) {
            dstPagNode.setSdkParam();
            // add related dyn callsite
            let arkPtrInvokeExpr = new Expr_1.ArkPtrInvokeExpr(cs.args[index].getType().getMethodSignature(), paramValue, args);
            let sdkParamInvokeStmt = new Stmt_1.ArkInvokeStmt(arkPtrInvokeExpr);
            let calleeNode = this.cg.getCallGraphNodeByMethod(cs.args[index].getType().getMethodSignature());
            let sdkParamCallSite = this.cg.getCallSiteManager().newDynCallSite(sdkParamInvokeStmt, args, calleeNode.getID(), funcID);
            dstPagNode.addRelatedDynCallSite(sdkParamCallSite);
        }
        this.pag.addPagEdge(srcPagNode, dstPagNode, Pag_1.PagEdgeKind.Copy, cs.callStmt);
        srcNodes.push(srcPagNode.getID());
        // passed the cid of args
        for (let arg of args) {
            if (arg instanceof Constant_1.Constant || arg instanceof Expr_1.AbstractExpr) {
                continue;
            }
            srcPagNode = this.pagBuilder.getOrNewPagNode(callerCid, arg, cs.callStmt);
            dstPagNode = this.pagBuilder.getOrNewPagNode(calleeCid, arg, cs.callStmt);
            this.pag.addPagEdge(srcPagNode, dstPagNode, Pag_1.PagEdgeKind.Copy, cs.callStmt);
            srcNodes.push(srcPagNode.getID());
        }
        return;
    }
    addTaskObj2CGNodeMap(cs, index) {
        // Obtain the function that the task thread is going to execute through the param function.
        let invokeExpr = cs.callStmt.getInvokeExpr();
        if (cs.args === undefined) {
            return;
        }
        let arg_type = cs.args[index].getType();
        if (arg_type instanceof Type_1.FunctionType) {
            let cgnode = this.cg.getCallGraphNodeByMethod(arg_type.getMethodSignature());
            this.taskObj2CGNodeMap.set(invokeExpr.getBase(), cgnode);
            this.taskObj2ConstructorStmtMap.set(invokeExpr.getBase(), cs.callStmt);
        }
    }
    getTaskObj2CGNodeMap() {
        return this.taskObj2CGNodeMap;
    }
    getTaskObj2ConstructorStmtMap() {
        return this.taskObj2ConstructorStmtMap;
    }
}
exports.TaskPoolPlugin = TaskPoolPlugin;
