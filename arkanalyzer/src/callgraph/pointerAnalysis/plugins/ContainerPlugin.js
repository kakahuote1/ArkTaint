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
exports.ContainerPlugin = void 0;
const Pag_1 = require("../Pag");
const PagBuilder_1 = require("../PagBuilder");
const PTAUtils_1 = require("../PTAUtils");
const Stmt_1 = require("../../../core/base/Stmt");
const Type_1 = require("../../../core/base/Type");
// built-in container APIs
const containerApiList = [PTAUtils_1.BuiltApiType.ArrayPush, PTAUtils_1.BuiltApiType.MapSet, PTAUtils_1.BuiltApiType.MapGet, PTAUtils_1.BuiltApiType.SetAdd, PTAUtils_1.BuiltApiType.Foreach];
/**
 * ContainerPlugin processes built-in container APIs like Array, Set, and Map.
 */
class ContainerPlugin {
    constructor(pag, pagBuilder, cg) {
        this.pag = pag;
        this.pagBuilder = pagBuilder;
        this.cg = cg;
    }
    getName() {
        return 'ContainerPlugin';
    }
    canHandle(cs, cgNode) {
        let calleeFuncID = cs.getCalleeFuncID();
        let calleeMethod = this.cg.getArkMethodByFuncID(calleeFuncID);
        if (!calleeMethod) {
            return false;
        }
        let methodType = (0, PTAUtils_1.getBuiltInApiType)(calleeMethod.getSignature());
        return containerApiList.includes(methodType);
    }
    processCallSite(cs, cid, basePTNode) {
        const baseValue = cs.callStmt.getInvokeExpr().getBase();
        const baseNode = this.pag.getNode(basePTNode);
        const calleeFuncID = cs.getCalleeFuncID();
        const calleeMethod = this.cg.getArkMethodByFuncID(calleeFuncID);
        const methodType = (0, PTAUtils_1.getBuiltInApiType)(calleeMethod.getSignature());
        let srcNodes = [];
        if (!(baseNode instanceof Pag_1.PagNewContainerExprNode)) {
            return srcNodes;
        }
        switch (methodType) {
            case PTAUtils_1.BuiltApiType.ArrayPush:
                // TODO: process push(...[])
                this.processArrayPush(cs, cid, basePTNode, baseValue, srcNodes);
                break;
            case PTAUtils_1.BuiltApiType.SetAdd:
                this.processSetAdd(cs, cid, basePTNode, baseValue, srcNodes);
                break;
            case PTAUtils_1.BuiltApiType.MapSet:
                this.processMapSet(cs, cid, basePTNode, baseValue, srcNodes);
                break;
            case PTAUtils_1.BuiltApiType.MapGet:
                this.processMapGet(cs, cid, basePTNode, baseValue, srcNodes);
                break;
            case PTAUtils_1.BuiltApiType.Foreach:
                this.processForeach(cs, cid, basePTNode, baseValue, srcNodes, calleeMethod);
                break;
            default:
        }
        return srcNodes;
    }
    processArrayPush(cs, cid, basePt, baseValue, srcNodes) {
        const argIndex = 0;
        let argValue = cs.args[argIndex];
        if (!argValue) {
            return;
        }
        const argNode = this.pag.getOrNewNode(cid, argValue, cs.callStmt);
        const containerFieldNode = this.pag.getOrClonePagContainerFieldNode(basePt, baseValue, 'Array');
        if (!containerFieldNode) {
            return;
        }
        this.pag.addPagEdge(argNode, containerFieldNode, Pag_1.PagEdgeKind.Copy, cs.callStmt);
        srcNodes.push(argNode.getID());
        return;
    }
    processSetAdd(cs, cid, basePt, baseValue, srcNodes) {
        const argIndex = 0;
        let argValue = cs.args[argIndex];
        if (!argValue) {
            return;
        }
        const argNode = this.pag.getOrNewNode(cid, argValue, cs.callStmt);
        const containerFieldNode = this.pag.getOrClonePagContainerFieldNode(basePt, baseValue, 'Set');
        if (!containerFieldNode) {
            return;
        }
        this.pag.addPagEdge(argNode, containerFieldNode, Pag_1.PagEdgeKind.Copy, cs.callStmt);
        srcNodes.push(argNode.getID());
        return;
    }
    processMapSet(cs, cid, basePt, baseValue, srcNodes) {
        const argIndex = 1;
        let argValue = cs.args[argIndex];
        if (!argValue) {
            return;
        }
        const argNode = this.pag.getOrNewNode(cid, argValue, cs.callStmt);
        const containerFieldNode = this.pag.getOrClonePagContainerFieldNode(basePt, baseValue, 'Map');
        if (!containerFieldNode) {
            return;
        }
        this.pag.addPagEdge(argNode, containerFieldNode, Pag_1.PagEdgeKind.Copy, cs.callStmt);
        srcNodes.push(argNode.getID());
        return;
    }
    processMapGet(cs, cid, basePt, baseValue, srcNodes) {
        const ivkExpr = cs.callStmt.getInvokeExpr();
        if (!ivkExpr || !(cs.callStmt instanceof Stmt_1.ArkAssignStmt)) {
            return;
        }
        const leftValue = cs.callStmt.getLeftOp();
        const leftValueNode = this.pag.getOrNewNode(cid, leftValue, cs.callStmt);
        const containerFieldNode = this.pag.getOrClonePagContainerFieldNode(basePt, baseValue, 'Map');
        if (!containerFieldNode) {
            return;
        }
        this.pag.addPagEdge(containerFieldNode, leftValueNode, Pag_1.PagEdgeKind.Copy, cs.callStmt);
        srcNodes.push(containerFieldNode.getID());
        return;
    }
    processForeach(cs, cid, basePt, baseValue, srcNodes, calleeMethod) {
        const containerName = calleeMethod.getDeclaringArkClass().getName();
        const callbackLocalType = cs.args[0].getType();
        if (!(callbackLocalType instanceof Type_1.FunctionType)) {
            return;
        }
        const callbackMethodSig = callbackLocalType.getMethodSignature();
        const callbackNode = this.cg.getCallGraphNodeByMethod(callbackMethodSig);
        const callbackFuncID = callbackNode.getID();
        const callbackMethod = this.cg.getArkMethodByFuncID(callbackFuncID);
        const containerFieldNode = this.pag.getOrClonePagContainerFieldNode(basePt, baseValue, containerName);
        let calleeCid = this.pagBuilder.getContextSelector().selectContext(cid, cs, basePt, callbackFuncID);
        const paramRefValues = callbackMethod?.getParameterRefs();
        if (!paramRefValues || paramRefValues.length < 1) {
            return;
        }
        /**
         * NOTE!: paramRefValues[0] OR paramRefValues[1]?
         * when the callback use the closure, the first parameter is LexicalEnvType,
         * when not use, we need to use the second parameter as the element type.
         */
        let elementRef = paramRefValues[0];
        if (elementRef.getType() instanceof Type_1.LexicalEnvType) {
            elementRef = paramRefValues[1];
        }
        const elementNode = this.pag.getOrNewNode(calleeCid, elementRef, cs.callStmt);
        this.pag.addPagEdge(containerFieldNode, elementNode, Pag_1.PagEdgeKind.Copy, cs.callStmt);
        srcNodes.push(containerFieldNode.getID());
        this.pagBuilder.buildFuncPagAndAddToWorklist(new PagBuilder_1.CSFuncID(calleeCid, callbackFuncID));
        return;
    }
}
exports.ContainerPlugin = ContainerPlugin;
//# sourceMappingURL=ContainerPlugin.js.map