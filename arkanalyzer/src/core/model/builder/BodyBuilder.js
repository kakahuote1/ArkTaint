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
exports.BodyBuilder = void 0;
const ArkBody_1 = require("../ArkBody");
const ArkSignature_1 = require("../ArkSignature");
const CfgBuilder_1 = require("../../graph/builder/CfgBuilder");
const Local_1 = require("../../base/Local");
const ArkMethodBuilder_1 = require("./ArkMethodBuilder");
const Const_1 = require("../../common/Const");
const Ref_1 = require("../../base/Ref");
const Stmt_1 = require("../../base/Stmt");
const Type_1 = require("../../base/Type");
const Expr_1 = require("../../base/Expr");
class BodyBuilder {
    constructor(methodSignature, sourceAstNode, declaringMethod, sourceFile) {
        this.cfgBuilder = new CfgBuilder_1.CfgBuilder(sourceAstNode, methodSignature.getMethodSubSignature().getMethodName(), declaringMethod, sourceFile);
        this.paramsPosition = new Map();
    }
    build() {
        this.cfgBuilder.buildCfgBuilder();
        if (!this.cfgBuilder.isBodyEmpty()) {
            const { cfg, locals, globals, aliasTypeMap, traps } = this.cfgBuilder.buildCfg();
            if (globals !== null) {
                this.setGlobals(globals);
            }
            if (globals === null) {
                cfg.buildDefUseStmt(locals);
            }
            else {
                cfg.buildDefUseStmt(locals, globals);
            }
            return new ArkBody_1.ArkBody(locals, cfg, aliasTypeMap, traps.length ? traps : undefined);
        }
        return null;
    }
    getCfgBuilder() {
        return this.cfgBuilder;
    }
    getGlobals() {
        return this.globals;
    }
    setGlobals(globals) {
        this.globals = globals;
    }
    getParamsPositions() {
        return this.paramsPosition;
    }
    setParamsPositions(paramsPosition) {
        this.paramsPosition = paramsPosition;
    }
    /**
     * Find out all locals in the parent method which are used by the childrenChain, these locals are the closures of the root node of the childrenChain.
     * childrenChain contains all nested method from the root node of the childrenChain.
     * baseLocals are all locals defined in the outer function.
     * allNestedLocals are collect all locals defined in all outer functions of this childrenChain.
     * Only the globals of the root of the childrenChain, which are in the baseLocals but not in the allNestedLocals are the actual closures that in baseLocals.
     */
    findClosuresUsedInNested(childrenChain, baseLocals, allNestedLocals) {
        let closuresRes = [];
        const nestedMethod = childrenChain.parent;
        let nestedGlobals = nestedMethod.getBodyBuilder()?.getGlobals();
        if (nestedGlobals !== undefined) {
            for (let global of nestedGlobals.values()) {
                const nestedLocal = allNestedLocals.get(global.getName());
                const closure = baseLocals.get(global.getName());
                if (nestedLocal === undefined && closure !== undefined) {
                    closuresRes.push(closure);
                }
            }
        }
        const children = childrenChain.children;
        if (children === null) {
            return closuresRes;
        }
        for (let chain of children) {
            const nestedLocals = nestedMethod.getBody()?.getLocals();
            if (nestedLocals !== undefined) {
                nestedLocals.forEach((value, key) => {
                    allNestedLocals.set(key, value);
                });
            }
            const closures = this.findClosuresUsedInNested(chain, baseLocals, allNestedLocals);
            if (closures) {
                closuresRes.push(...closures);
            }
        }
        return closuresRes;
    }
    /**
     * 1. Find out all locals in the parent method which are used by the childrenChain, these locals are the closures of the root node of the childrenChain.
     * 2. Create a lexical env local in the parent method, and pass it to root node of the childrenChain through the method signature.
     * 3. Update the root node of the childrenChain to add parameterRef assign stmt and closureRef assign stmt.
     * 4. Recursively do this for all nested method level by level.
     */
    buildLexicalEnv(childrenChain, baseLocals, index) {
        let usedClosures = this.findClosuresUsedInNested(childrenChain, baseLocals, new Map());
        const nestedMethod = childrenChain.parent;
        const nestedSignature = nestedMethod.getImplementationSignature();
        if (nestedSignature !== null && usedClosures !== null && usedClosures.length > 0) {
            let lexicalEnv = new Type_1.LexicalEnvType(nestedSignature, usedClosures);
            const closuresLocal = new Local_1.Local(`${Const_1.LEXICAL_ENV_NAME_PREFIX}${index++}`, lexicalEnv);
            baseLocals.set(closuresLocal.getName(), closuresLocal);
            this.updateNestedMethodWithClosures(nestedMethod, closuresLocal);
        }
        else if (usedClosures === null || usedClosures.length === 0) {
            this.moveCurrentMethodLocalToGlobal(nestedMethod);
        }
        const nextNestedChains = childrenChain.children;
        if (nextNestedChains === null) {
            return index;
        }
        for (let nextChain of nextNestedChains) {
            const newBaseLocals = nestedMethod.getBody()?.getLocals();
            if (newBaseLocals === undefined) {
                return index;
            }
            index = this.buildLexicalEnv(nextChain, newBaseLocals, index);
        }
        return index;
    }
    /**
     * Find out and tag all closures from globals, and remove closures from both globals and locals.
     * Precondition: body build has been done. All locals, globals and closures are both set as Local in body,
     * while potential globals and closures are also recorded in bodybuilder.
     * Constraint: only the outermost function can call this method to recursively handle closures of itself as well as all nested methods.
     */
    handleGlobalAndClosure() {
        /**
         * Step1: Handle the outermost function, take it as Level 0.
         * There must be no closures in Level 0. So only need to remove the locals which with the same name as the ones in globals.
         */
        let outerMethod = this.getCfgBuilder().getDeclaringMethod();
        let outerGlobals = outerMethod.getBodyBuilder()?.getGlobals();
        outerMethod.freeBodyBuilder();
        let outerLocals = outerMethod.getBody()?.getLocals();
        if (outerGlobals !== undefined && outerLocals !== undefined) {
            outerGlobals.forEach((value, key) => {
                const local = outerLocals.get(key);
                if (local !== undefined) {
                    value.addUsedStmts(local.getUsedStmts());
                    outerLocals.delete(key);
                }
            });
            if (outerGlobals.size > 0) {
                outerMethod.getBody()?.setUsedGlobals(outerGlobals);
            }
        }
        let nestedMethodChains = this.generateNestedMethodChains(outerMethod).children;
        if (nestedMethodChains === null || outerLocals === undefined) {
            return;
        }
        let closuresIndex = 0;
        for (let nestedChain of nestedMethodChains) {
            /**
             * Step2: Handle each nested function in Level 1 one by one.
             * Find out all closures from Level 0 used by these Level 1 functions as well as all their children nested functions.
             * This will be done level by level recursively.
             */
            closuresIndex = this.buildLexicalEnv(nestedChain, outerLocals, closuresIndex);
            /**
             * Step3: Delete old globals which are recognized as closures, then the rest globals are the true globals.
             * The redundancy locals should be deleted but the used stmts of them should be restored to globals.
             * This will be done level by level recursively.
             */
            this.reorganizeGlobalAndLocal(nestedChain);
            /**
             * Step4: Infer UnclearReferenceType to check whether it is the type alias define in its parent function..
             */
            this.inferTypesDefineInOuter(outerMethod, nestedChain);
            /**
             * Step5: For each nested function, find out whether it is called by its parent function and update the related locals, globals and stmts.
             */
            this.updateNestedMethodUsedInOuter(nestedChain);
            this.freeBodyBuilder(nestedChain);
        }
    }
    freeBodyBuilder(nestedChain) {
        nestedChain.parent.freeBodyBuilder();
        const childrenChains = nestedChain.children;
        if (childrenChains === null) {
            return;
        }
        for (const chain of childrenChains) {
            this.freeBodyBuilder(chain);
        }
    }
    updateLocalTypesWithTypeAlias(locals, typeAliases) {
        for (let local of locals.values()) {
            const newType = this.inferUnclearReferenceTypeWithTypeAlias(local.getType(), typeAliases);
            if (newType !== null) {
                local.setType(newType);
            }
        }
    }
    inferUnclearReferenceTypeWithTypeAlias(localType, typeAliases) {
        if (localType instanceof Type_1.ArrayType && localType.getBaseType() instanceof Type_1.UnclearReferenceType) {
            const typeAlias = typeAliases.get(localType.getBaseType().getName());
            if (typeAlias !== undefined) {
                localType.setBaseType(typeAlias[0]);
                return localType;
            }
            return null;
        }
        if (localType instanceof Type_1.UnionType) {
            const optionTypes = localType.getTypes();
            for (let i = 0; i < optionTypes.length; i++) {
                const newType = this.inferUnclearReferenceTypeWithTypeAlias(optionTypes[i], typeAliases);
                if (newType !== null) {
                    optionTypes[i] = newType;
                }
            }
            return localType;
        }
        if (localType instanceof Type_1.UnclearReferenceType) {
            const typeAlias = typeAliases.get(localType.getName());
            if (typeAlias !== undefined) {
                return typeAlias[0];
            }
        }
        return null;
    }
    generateNestedMethodChains(outerMethod) {
        let candidateMethods = [];
        outerMethod
            .getDeclaringArkClass()
            .getMethods()
            .forEach(method => {
            if (method.getName().startsWith(Const_1.NAME_PREFIX) && method.getName().endsWith(`${Const_1.NAME_DELIMITER}${outerMethod.getName()}`)) {
                candidateMethods.push(method);
            }
        });
        const childrenChains = this.getNestedChildrenChains(outerMethod, candidateMethods);
        if (childrenChains.length > 0) {
            return { parent: outerMethod, children: childrenChains };
        }
        return { parent: outerMethod, children: null };
    }
    getNestedChildrenChains(parentMethod, candidateMethods) {
        let nestedMethodChain = [];
        for (let method of candidateMethods) {
            const outerMethodSignature = method.getOuterMethod()?.getSignature();
            if (outerMethodSignature !== undefined && (0, ArkSignature_1.methodSignatureCompare)(parentMethod.getSignature(), outerMethodSignature)) {
                const childrenChains = this.getNestedChildrenChains(method, candidateMethods);
                if (childrenChains.length > 0) {
                    nestedMethodChain.push({ parent: method, children: childrenChains });
                }
                else {
                    nestedMethodChain.push({ parent: method, children: null });
                }
            }
        }
        return nestedMethodChain;
    }
    moveCurrentMethodLocalToGlobal(method) {
        const globals = method.getBodyBuilder()?.getGlobals();
        const locals = method.getBody()?.getLocals();
        if (locals === undefined || globals === undefined) {
            return;
        }
        globals.forEach((value, key) => {
            const local = locals.get(key);
            if (local !== undefined) {
                value.addUsedStmts(local.getUsedStmts());
                locals.delete(key);
            }
        });
        if (globals.size > 0) {
            method.getBody()?.setUsedGlobals(globals);
        }
    }
    reorganizeGlobalAndLocal(nestedChain) {
        const nestedMethod = nestedChain.parent;
        const params = nestedMethod.getSubSignature().getParameters();
        const globals = nestedMethod.getBodyBuilder()?.getGlobals();
        if (params.length > 0 && params[0].getType() instanceof Type_1.LexicalEnvType && globals !== undefined) {
            const closures = params[0].getType().getClosures();
            for (let closure of closures) {
                globals.delete(closure.getName());
            }
        }
        this.moveCurrentMethodLocalToGlobal(nestedMethod);
        const childrenChains = nestedChain.children;
        if (childrenChains === null) {
            return;
        }
        for (const chain of childrenChains) {
            this.reorganizeGlobalAndLocal(chain);
        }
    }
    // 对嵌套函数中的UnclearReferenceType类型的变量进行类型推导，类型是否为外层函数中定义的类型别名
    inferTypesDefineInOuter(outerMethod, childrenChain) {
        const typeAliases = outerMethod.getBody()?.getAliasTypeMap();
        const nestedLocals = childrenChain.parent.getBody()?.getLocals();
        if (typeAliases !== undefined && nestedLocals !== undefined) {
            this.updateLocalTypesWithTypeAlias(nestedLocals, typeAliases);
        }
        const childrenChains = childrenChain.children;
        if (childrenChains === null) {
            return;
        }
        for (const chain of childrenChains) {
            this.inferTypesDefineInOuter(childrenChain.parent, chain);
        }
    }
    updateNestedMethodUsedInOuter(nestedChain) {
        const nestedMethod = nestedChain.parent;
        const outerMethod = nestedMethod.getOuterMethod();
        if (outerMethod === undefined) {
            return;
        }
        const outerLocals = outerMethod.getBody()?.getLocals();
        if (outerLocals !== undefined) {
            for (let local of outerLocals.values()) {
                if (local.getType() instanceof Type_1.LexicalEnvType &&
                    (0, ArkSignature_1.methodSignatureCompare)(local.getType().getNestedMethod(), nestedMethod.getSignature())) {
                    this.updateOuterMethodWithClosures(outerMethod, nestedMethod, local);
                    break;
                }
            }
        }
        const nestedMethodName = nestedMethod.getName();
        const originalMethodName = this.getOriginalNestedMethodName(nestedMethodName) ?? '';
        const outerGlobals = outerMethod.getBody()?.getUsedGlobals();
        const callGlobal = outerGlobals?.get(nestedMethodName) ?? outerGlobals?.get(originalMethodName);
        if (callGlobal !== undefined && callGlobal instanceof Ref_1.GlobalRef && callGlobal.getRef() === null) {
            const fieldSignature = new ArkSignature_1.FieldSignature(nestedMethodName, nestedMethod.getDeclaringArkClass().getSignature(), new Type_1.FunctionType(nestedMethod.getSignature()));
            callGlobal.setRef(new Ref_1.ArkStaticFieldRef(fieldSignature));
        }
        const childrenChains = nestedChain.children;
        if (childrenChains === null) {
            return;
        }
        for (const chain of childrenChains) {
            this.updateNestedMethodUsedInOuter(chain);
        }
    }
    updateNestedMethodWithClosures(nestedMethod, closuresLocal) {
        if (!(closuresLocal.getType() instanceof Type_1.LexicalEnvType)) {
            return;
        }
        const declareSignatures = nestedMethod.getDeclareSignatures();
        declareSignatures?.forEach((signature, index) => {
            nestedMethod.setDeclareSignatureWithIndex(this.createNewSignatureWithClosures(closuresLocal, signature), index);
        });
        const implementSignature = nestedMethod.getImplementationSignature();
        if (implementSignature !== null) {
            nestedMethod.setImplementationSignature(this.createNewSignatureWithClosures(closuresLocal, implementSignature));
        }
        this.addClosureParamsAssignStmts(closuresLocal, nestedMethod);
    }
    updateOuterMethodWithClosures(outerMethod, nestedMethod, closuresLocal) {
        const nestedMethodName = nestedMethod.getName();
        const nestedMethodLocal = outerMethod.getBody()?.getLocals().get(nestedMethodName);
        if (nestedMethodLocal !== undefined) {
            this.updateLocalInfoWithClosures(nestedMethodLocal, outerMethod, nestedMethod, closuresLocal);
        }
        else {
            const nestedMethodGlobal = outerMethod.getBody()?.getUsedGlobals()?.get(nestedMethodName);
            if (nestedMethodGlobal !== undefined && nestedMethodGlobal instanceof Ref_1.GlobalRef) {
                this.updateGlobalInfoWithClosures(nestedMethodGlobal, outerMethod, nestedMethod, closuresLocal);
            }
        }
        const originalMethodName = this.getOriginalNestedMethodName(nestedMethodName);
        if (originalMethodName === null) {
            return;
        }
        const originalMethodLocal = outerMethod.getBody()?.getLocals().get(originalMethodName);
        if (originalMethodLocal !== undefined) {
            this.updateLocalInfoWithClosures(originalMethodLocal, outerMethod, nestedMethod, closuresLocal);
        }
        else {
            const originalMethodGlobal = outerMethod.getBody()?.getUsedGlobals()?.get(originalMethodName);
            if (originalMethodGlobal !== undefined && originalMethodGlobal instanceof Ref_1.GlobalRef) {
                this.updateGlobalInfoWithClosures(originalMethodGlobal, outerMethod, nestedMethod, closuresLocal);
            }
        }
    }
    getOriginalNestedMethodName(nestedMethodName) {
        if (nestedMethodName.startsWith(Const_1.NAME_PREFIX) && nestedMethodName.includes(Const_1.NAME_DELIMITER)) {
            const nameComponents = nestedMethodName.slice(1).split(Const_1.NAME_DELIMITER);
            if (nameComponents.length > 1) {
                return nameComponents[0];
            }
        }
        return null;
    }
    updateGlobalInfoWithClosures(globalRef, outerMethod, nestedMethod, closuresLocal) {
        if (globalRef.getRef() !== null) {
            return;
        }
        const methodSignature = nestedMethod.getImplementationSignature();
        if (methodSignature === null) {
            return;
        }
        const lexicalEnv = closuresLocal.getType();
        if (!(lexicalEnv instanceof Type_1.LexicalEnvType)) {
            return;
        }
        const fieldSignature = new ArkSignature_1.FieldSignature(methodSignature.getMethodSubSignature().getMethodName(), methodSignature.getDeclaringClassSignature(), new Type_1.ClosureType(lexicalEnv, methodSignature));
        globalRef.setRef(new Ref_1.ArkStaticFieldRef(fieldSignature));
        this.updateAbstractInvokeExprWithClosures(globalRef, outerMethod.getSignature(), nestedMethod.getSignature(), closuresLocal);
    }
    updateLocalInfoWithClosures(local, outerMethod, nestedMethod, closuresLocal) {
        const localType = local.getType();
        if (!(localType instanceof Type_1.FunctionType)) {
            return;
        }
        const lexicalEnv = closuresLocal.getType();
        if (!(lexicalEnv instanceof Type_1.LexicalEnvType)) {
            return;
        }
        // 更新local的类型为ClosureType，methodSignature为内层嵌套函数
        const nestedMethodSignature = nestedMethod.getImplementationSignature();
        if (nestedMethodSignature !== null) {
            local.setType(new Type_1.ClosureType(lexicalEnv, nestedMethodSignature, localType.getRealGenericTypes()));
        }
        else {
            local.setType(new Type_1.ClosureType(lexicalEnv, localType.getMethodSignature(), localType.getRealGenericTypes()));
        }
        this.updateAbstractInvokeExprWithClosures(local, outerMethod.getSignature(), nestedMethod.getSignature(), closuresLocal);
    }
    // 更新所有stmt中调用内层函数处的AbstractInvokeExpr中的函数签名和实参args，加入闭包参数
    // 更新所有stmt中定义的函数指针的usedStmt中的函数签名和实参args，加入闭包参数
    updateAbstractInvokeExprWithClosures(value, outerMethodSignature, nestedMethodSignature, closuresLocal) {
        for (const usedStmt of value.getUsedStmts()) {
            if (usedStmt instanceof Stmt_1.ArkInvokeStmt) {
                this.updateSignatureAndArgsInArkInvokeExpr(usedStmt, nestedMethodSignature, closuresLocal);
            }
            else if (usedStmt instanceof Stmt_1.ArkAssignStmt) {
                const rightOp = usedStmt.getRightOp();
                if (rightOp instanceof Expr_1.AbstractInvokeExpr) {
                    this.updateSignatureAndArgsInArkInvokeExpr(usedStmt, nestedMethodSignature, closuresLocal);
                }
                const leftOp = usedStmt.getLeftOp();
                if (leftOp instanceof Local_1.Local) {
                    leftOp.setType(rightOp.getType());
                }
            }
            else if (usedStmt instanceof Stmt_1.ArkReturnStmt) {
                outerMethodSignature.getMethodSubSignature().setReturnType(value.getType());
            }
            const defValue = usedStmt.getDef();
            if (defValue === null) {
                continue;
            }
            if ((defValue instanceof Local_1.Local || defValue instanceof Ref_1.GlobalRef) && defValue.getType() instanceof Type_1.FunctionType) {
                this.updateAbstractInvokeExprWithClosures(defValue, outerMethodSignature, nestedMethodSignature, closuresLocal);
            }
        }
    }
    createNewSignatureWithClosures(closuresLocal, oldSignature) {
        let oldSubSignature = oldSignature.getMethodSubSignature();
        const params = oldSubSignature.getParameters();
        const closuresParam = new ArkMethodBuilder_1.MethodParameter();
        closuresParam.setName(closuresLocal.getName());
        closuresParam.setType(closuresLocal.getType());
        params.unshift(closuresParam);
        let newSubSignature = new ArkSignature_1.MethodSubSignature(oldSubSignature.getMethodName(), params, oldSubSignature.getReturnType(), oldSubSignature.isStatic());
        return new ArkSignature_1.MethodSignature(oldSignature.getDeclaringClassSignature(), newSubSignature);
    }
    updateSignatureAndArgsInArkInvokeExpr(stmt, methodSignature, closuresLocal) {
        let expr;
        if (stmt instanceof Stmt_1.ArkInvokeStmt) {
            expr = stmt.getInvokeExpr();
        }
        else {
            const rightOp = stmt.getRightOp();
            if (!(rightOp instanceof Expr_1.AbstractInvokeExpr)) {
                return;
            }
            expr = rightOp;
        }
        const exprMethodName = expr.getMethodSignature().getMethodSubSignature().getMethodName();
        const nestedMethodName = methodSignature.getMethodSubSignature().getMethodName();
        if (exprMethodName === nestedMethodName) {
            expr.setMethodSignature(this.createNewSignatureWithClosures(closuresLocal, methodSignature));
            expr.getArgs().unshift(closuresLocal);
            closuresLocal.addUsedStmt(stmt);
            return;
        }
        const originalMethodName = this.getOriginalNestedMethodName(nestedMethodName);
        if (originalMethodName !== null) {
            if (exprMethodName === originalMethodName || expr instanceof Expr_1.ArkPtrInvokeExpr) {
                expr.setMethodSignature(methodSignature);
                expr.getArgs().unshift(closuresLocal);
                closuresLocal.addUsedStmt(stmt);
            }
        }
    }
    addClosureParamsAssignStmts(closuresParam, method) {
        const lexicalEnv = closuresParam.getType();
        if (!(lexicalEnv instanceof Type_1.LexicalEnvType)) {
            return;
        }
        const closures = lexicalEnv.getClosures();
        if (closures.length === 0) {
            return;
        }
        const oldParamRefs = method.getParameterRefs();
        let body = method.getBody();
        if (body === undefined) {
            return;
        }
        let stmts = body.getCfg().getStartingBlock().getStmts();
        let index = 0;
        const parameterRef = new Ref_1.ArkParameterRef(index, lexicalEnv);
        const closuresLocal = new Local_1.Local(closuresParam.getName(), lexicalEnv);
        body.addLocal(closuresLocal.getName(), closuresLocal);
        let assignStmt = new Stmt_1.ArkAssignStmt(closuresLocal, parameterRef);
        assignStmt.setCfg(body.getCfg());
        body.getCfg().insertBefore(assignStmt, stmts[index]);
        closuresLocal.setDeclaringStmt(assignStmt);
        oldParamRefs?.forEach(paramRef => {
            index++;
            paramRef.setIndex(index);
        });
        for (let closure of closures) {
            let local = body.getLocals().get(closure.getName());
            if (local === undefined) {
                local = new Local_1.Local(closure.getName(), closure.getType());
                body.addLocal(local.getName(), local);
            }
            else {
                local.setType(closure.getType());
            }
            index++;
            const closureFieldRef = new Ref_1.ClosureFieldRef(closuresLocal, closure.getName(), closure.getType());
            let assignStmt = new Stmt_1.ArkAssignStmt(local, closureFieldRef);
            assignStmt.setCfg(body.getCfg());
            body.getCfg().insertBefore(assignStmt, stmts[index]);
            local.setDeclaringStmt(assignStmt);
            closuresLocal.addUsedStmt(assignStmt);
        }
    }
}
exports.BodyBuilder = BodyBuilder;
//# sourceMappingURL=BodyBuilder.js.map