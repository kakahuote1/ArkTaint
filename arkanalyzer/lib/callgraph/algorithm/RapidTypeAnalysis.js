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
exports.RapidTypeAnalysis = void 0;
const Expr_1 = require("../../core/base/Expr");
const AbstractAnalysis_1 = require("./AbstractAnalysis");
const logger_1 = __importStar(require("../../utils/logger"));
const logger = logger_1.default.getLogger(logger_1.LOG_MODULE_TYPE.ARKANALYZER, 'RTA');
class RapidTypeAnalysis extends AbstractAnalysis_1.AbstractAnalysis {
    constructor(scene, cg) {
        super(scene, cg);
        // TODO: signature duplicated check
        this.instancedClasses = new Set();
        // TODO: Set duplicated check
        this.ignoredCalls = new Map();
    }
    resolveCall(callerMethod, invokeStmt) {
        let invokeExpr = invokeStmt.getInvokeExpr();
        let resolveResult = [];
        if (!invokeExpr) {
            return [];
        }
        // process anonymous method call
        this.getParamAnonymousMethod(invokeExpr).forEach(method => {
            resolveResult.push(this.cg.getCallSiteManager().newCallSite(invokeStmt, undefined, this.cg.getCallGraphNodeByMethod(method).getID(), callerMethod));
        });
        let calleeMethod = this.resolveInvokeExpr(invokeExpr);
        if (!calleeMethod) {
            return resolveResult;
        }
        if (invokeExpr instanceof Expr_1.ArkStaticInvokeExpr) {
            // get specific method
            resolveResult.push(this.cg.getCallSiteManager().newCallSite(invokeStmt, undefined, this.cg.getCallGraphNodeByMethod(calleeMethod.getSignature()).getID(), callerMethod));
        }
        else {
            let declareClass = calleeMethod.getDeclaringArkClass();
            // TODO: super class method should be placed at the end
            this.getClassHierarchy(declareClass).forEach((arkClass) => {
                let possibleCalleeMethod = arkClass.getMethodWithName(calleeMethod.getName());
                if (possibleCalleeMethod && possibleCalleeMethod.isGenerated() &&
                    arkClass.getSignature().toString() !== declareClass.getSignature().toString()) {
                    // remove the generated method in extended classes
                    return;
                }
                if (!(possibleCalleeMethod && !possibleCalleeMethod.isAbstract())) {
                    return;
                }
                let calleeNode = this.cg.getCallGraphNodeByMethod(possibleCalleeMethod.getSignature());
                if (!this.instancedClasses.has(arkClass.getSignature())) {
                    this.addIgnoredCalls(arkClass.getSignature(), callerMethod, calleeNode.getID(), invokeStmt);
                }
                else {
                    resolveResult.push(this.cg.getCallSiteManager().newCallSite(invokeStmt, undefined, calleeNode.getID(), callerMethod));
                }
            });
        }
        return resolveResult;
    }
    preProcessMethod(funcID) {
        let newCallSites = [];
        let instancedClasses = this.collectInstancedClassesInMethod(funcID);
        let newlyInstancedClasses = new Set(Array.from(instancedClasses).filter(item => !this.instancedClasses.has(item)));
        newlyInstancedClasses.forEach(sig => {
            let ignoredCalls = this.ignoredCalls.get(sig);
            if (ignoredCalls) {
                ignoredCalls.forEach(call => {
                    this.cg.addDynamicCallEdge(call.caller, call.callee, call.callStmt);
                    newCallSites.push(this.cg.getCallSiteManager().newCallSite(call.callStmt, undefined, call.callee, call.caller));
                });
            }
            this.instancedClasses.add(sig);
            this.ignoredCalls.delete(sig);
        });
        return newCallSites;
    }
    collectInstancedClassesInMethod(funcID) {
        let instancedClasses = new Set();
        let arkMethod = this.cg.getArkMethodByFuncID(funcID);
        if (!arkMethod) {
            logger.error(`can not find arkMethod by funcID`);
            return instancedClasses;
        }
        let cfg = arkMethod.getCfg();
        if (!cfg) {
            logger.error(`arkMethod ${arkMethod.getSignature().toString()} has no cfg`);
            return instancedClasses;
        }
        for (let stmt of cfg.getStmts()) {
            let stmtExpr = stmt.getExprs()[0];
            if (stmtExpr instanceof Expr_1.ArkNewExpr) {
                let classSig = stmtExpr.getType().getClassSignature();
                if (classSig != null) {
                    // TODO: need to check if different stmt has single sig
                    instancedClasses.add(classSig);
                }
            }
        }
        return instancedClasses;
    }
    addIgnoredCalls(arkClass, callerID, calleeID, invokeStmt) {
        var _a;
        let classMap = (_a = this.ignoredCalls.get(arkClass)) !== null && _a !== void 0 ? _a : new Set();
        classMap.add({ caller: callerID, callee: calleeID, callStmt: invokeStmt });
        this.ignoredCalls.set(arkClass, classMap);
    }
}
exports.RapidTypeAnalysis = RapidTypeAnalysis;
