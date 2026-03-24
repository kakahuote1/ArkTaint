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
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AbstractAnalysis = void 0;
const Type_1 = require("../../core/base/Type");
const logger_1 = __importStar(require("../../utils/logger"));
const PtsDS_1 = require("../pointerAnalysis/PtsDS");
const logger = logger_1.default.getLogger(logger_1.LOG_MODULE_TYPE.ARKANALYZER, 'CG');
class AbstractAnalysis {
    constructor(s, cg) {
        this.workList = [];
        this.scene = s;
        this.cg = cg;
    }
    getScene() {
        return this.scene;
    }
    getCallGraph() {
        return this.cg;
    }
    resolveInvokeExpr(invokeExpr) {
        const method = this.scene.getMethod(invokeExpr.getMethodSignature());
        if (method != null) {
            return method;
        }
        return undefined;
    }
    getClassHierarchy(arkClass) {
        // TODO: remove abstract class
        let classWorkList = [arkClass];
        // TODO: check class with no super Class
        let classHierarchy = [];
        while (classWorkList.length > 0) {
            // TODO: no dumplicated check, TS doesn't allow multi extend
            let tempClass = classWorkList.shift();
            classWorkList.push(...tempClass.getExtendedClasses().values());
            classHierarchy.push(tempClass);
        }
        return classHierarchy;
    }
    start(displayGeneratedMethod) {
        this.init();
        while (this.workList.length !== 0) {
            const method = this.workList.shift();
            const cgNode = this.cg.getNode(method);
            if (this.processedMethod.contains(method) || cgNode.isSdkMethod()) {
                continue;
            }
            // pre process for RTA only
            this.preProcessMethod(method).forEach((cs) => {
                this.workList.push(cs.calleeFuncID);
            });
            this.processMethod(method).forEach((cs) => {
                this.processCallSite(method, cs, displayGeneratedMethod);
            });
        }
    }
    projectStart(displayGeneratedMethod) {
        this.cgBuilder.buildCGNodes(this.scene.getMethods());
        for (let n of this.cg.getNodesIter()) {
            let cgNode = n;
            if (cgNode.isSdkMethod()) {
                continue;
            }
            this.preProcessMethod(cgNode.getID());
            this.processMethod(cgNode.getID()).forEach((cs) => {
                this.processCallSite(cgNode.getID(), cs, displayGeneratedMethod, true);
            });
        }
        this.cgBuilder.setEntries();
    }
    processCallSite(method, cs, displayGeneratedMethod, isProject = false) {
        var _a;
        let me = this.cg.getArkMethodByFuncID(cs.calleeFuncID);
        let meNode = this.cg.getNode(cs.calleeFuncID);
        this.addCallGraphEdge(method, me, cs, displayGeneratedMethod);
        if (isProject) {
            return;
        }
        this.processedMethod.insert(cs.callerFuncID);
        if (this.processedMethod.contains(cs.calleeFuncID) || meNode.isSdkMethod()) {
            return;
        }
        if (displayGeneratedMethod || !(me === null || me === void 0 ? void 0 : me.isGenerated())) {
            this.workList.push(cs.calleeFuncID);
            logger.trace(`New workList item ${cs.calleeFuncID}: ${(_a = this.cg.getArkMethodByFuncID(cs.calleeFuncID)) === null || _a === void 0 ? void 0 : _a.getSignature().toString()}`);
        }
    }
    init() {
        this.processedMethod = new ((0, PtsDS_1.createPtsCollectionCtor)(PtsDS_1.PtsCollectionType.BitVector))();
        this.cg.getEntries().forEach(entryFunc => {
            this.workList.push(entryFunc);
        });
    }
    processMethod(methodID) {
        let cgNode = this.cg.getNode(methodID);
        let arkMethod = this.scene.getMethod(cgNode.getMethod(), true);
        let calleeMethods = [];
        if (!arkMethod) {
            throw new Error('can not find method');
        }
        const cfg = arkMethod.getCfg();
        if (!cfg) {
            return [];
        }
        cfg.getStmts().forEach(stmt => {
            if (stmt.containsInvokeExpr()) {
                this.resolveCall(cgNode.getID(), stmt).forEach(callSite => {
                    calleeMethods.push(callSite);
                    this.cg.addStmtToCallSiteMap(stmt, callSite);
                    this.cg.addMethodToCallSiteMap(callSite.calleeFuncID, callSite);
                });
            }
        });
        return calleeMethods;
    }
    getParamAnonymousMethod(invokeExpr) {
        let paramMethod = [];
        invokeExpr.getArgs().forEach(args => {
            let argsType = args.getType();
            if (argsType instanceof Type_1.FunctionType) {
                paramMethod.push(argsType.getMethodSignature());
            }
        });
        return paramMethod;
    }
    addCallGraphEdge(caller, callee, cs, displayGeneratedMethod) {
        // check if need to display generated method
        if (!callee) {
            logger.error(`FuncID has no method ${cs.calleeFuncID}`);
        }
        else {
            if (displayGeneratedMethod || !(callee === null || callee === void 0 ? void 0 : callee.isGenerated())) {
                this.cg.addDynamicCallEdge(caller, cs.calleeFuncID, cs.callStmt);
            }
        }
    }
}
exports.AbstractAnalysis = AbstractAnalysis;
