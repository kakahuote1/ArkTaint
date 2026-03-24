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
exports.ClassHierarchyAnalysis = void 0;
const Expr_1 = require("../../core/base/Expr");
const AbstractAnalysis_1 = require("./AbstractAnalysis");
class ClassHierarchyAnalysis extends AbstractAnalysis_1.AbstractAnalysis {
    constructor(scene, cg, cb) {
        super(scene, cg);
        this.cgBuilder = cb;
    }
    resolveCall(callerMethod, invokeStmt) {
        let invokeExpr = invokeStmt.getInvokeExpr();
        const stmtDeclareClass = invokeStmt.getCfg().getDeclaringMethod().getDeclaringArkClass().getSignature();
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
            // block super invoke 
            if (this.checkSuperInvoke(invokeStmt, declareClass, stmtDeclareClass)) {
                resolveResult.push(this.cg.getCallSiteManager().newCallSite(invokeStmt, undefined, this.cg.getCallGraphNodeByMethod(calleeMethod.getSignature()).getID(), callerMethod));
                return resolveResult;
            }
            this.getClassHierarchy(declareClass).forEach((arkClass) => {
                let possibleCalleeMethod = arkClass.getMethodWithName(calleeMethod.getName());
                if (possibleCalleeMethod &&
                    possibleCalleeMethod.isGenerated() &&
                    arkClass.getSignature().toString() !== declareClass.getSignature().toString()) {
                    // remove the generated method in extended classes
                    return;
                }
                if (possibleCalleeMethod && !possibleCalleeMethod.isAbstract()) {
                    resolveResult.push(this.cg.getCallSiteManager().newCallSite(invokeStmt, undefined, this.cg.getCallGraphNodeByMethod(possibleCalleeMethod.getSignature()).getID(), callerMethod));
                }
            });
        }
        return resolveResult;
    }
    preProcessMethod() {
        // do nothing
        return [];
    }
    checkSuperInvoke(invokeStmt, declareClass, stmtDeclareClass) {
        const invokeExpr = invokeStmt.getInvokeExpr();
        if (invokeExpr instanceof Expr_1.ArkInstanceInvokeExpr) {
            const baseLocalName = invokeExpr.getBase().getName();
            if (baseLocalName === 'this' && declareClass.getSignature() !== stmtDeclareClass) {
                return true;
            }
        }
        return false;
    }
}
exports.ClassHierarchyAnalysis = ClassHierarchyAnalysis;
