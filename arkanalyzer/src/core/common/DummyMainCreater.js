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
exports.DummyMainCreater = void 0;
const entryMethodUtils_1 = require("../../utils/entryMethodUtils");
const Constant_1 = require("../base/Constant");
const Expr_1 = require("../base/Expr");
const Local_1 = require("../base/Local");
const Stmt_1 = require("../base/Stmt");
const Type_1 = require("../base/Type");
const BasicBlock_1 = require("../graph/BasicBlock");
const Cfg_1 = require("../graph/Cfg");
const ArkBody_1 = require("../model/ArkBody");
const ArkClass_1 = require("../model/ArkClass");
const ArkFile_1 = require("../model/ArkFile");
const ArkMethod_1 = require("../model/ArkMethod");
const ArkSignature_1 = require("../model/ArkSignature");
const ArkSignatureBuilder_1 = require("../model/builder/ArkSignatureBuilder");
const TSConst_1 = require("./TSConst");
const ArkMethodBuilder_1 = require("../model/builder/ArkMethodBuilder");
const ValueUtil_1 = require("./ValueUtil");
/**
收集所有的onCreate，onStart等函数，构造一个虚拟函数，具体为：
%statInit()
...
count = 0
while (true) {
    if (count === 1) {
        temp1 = new ability
        temp2 = new want
        temp1.onCreate(temp2)
    }
    if (count === 2) {
        onDestroy()
    }
    ...
    if (count === *) {
        callbackMethod1()
    }
    ...
}
return
如果是instanceInvoke还要先实例化对象，如果是其他文件的类或者方法还要添加import信息
 */
class DummyMainCreater {
    constructor(scene) {
        this.entryMethods = [];
        this.classLocalMap = new Map();
        this.dummyMain = new ArkMethod_1.ArkMethod();
        this.tempLocalIndex = 0;
        this.scene = scene;
        // Currently get entries from module.json5 can't visit all of abilities
        // Todo: handle ablity/component jump, then get entries from module.json5
        this.entryMethods = this.getMethodsFromAllAbilities();
        this.entryMethods.push(...this.getEntryMethodsFromComponents());
        this.entryMethods.push(...this.getCallbackMethods());
    }
    setEntryMethods(methods) {
        this.entryMethods = methods;
    }
    createDummyMain() {
        const dummyMainFile = new ArkFile_1.ArkFile(ArkFile_1.Language.JAVASCRIPT);
        dummyMainFile.setScene(this.scene);
        const dummyMainFileSignature = new ArkSignature_1.FileSignature(this.scene.getProjectName(), '@dummyFile');
        dummyMainFile.setFileSignature(dummyMainFileSignature);
        this.scene.setFile(dummyMainFile);
        const dummyMainClass = new ArkClass_1.ArkClass();
        dummyMainClass.setDeclaringArkFile(dummyMainFile);
        const dummyMainClassSignature = new ArkSignature_1.ClassSignature('@dummyClass', dummyMainClass.getDeclaringArkFile().getFileSignature(), dummyMainClass.getDeclaringArkNamespace()?.getSignature() || null);
        dummyMainClass.setSignature(dummyMainClassSignature);
        dummyMainFile.addArkClass(dummyMainClass);
        this.dummyMain = new ArkMethod_1.ArkMethod();
        this.dummyMain.setDeclaringArkClass(dummyMainClass);
        const methodSubSignature = ArkSignatureBuilder_1.ArkSignatureBuilder.buildMethodSubSignatureFromMethodName('@dummyMain');
        const methodSignature = new ArkSignature_1.MethodSignature(this.dummyMain.getDeclaringArkClass().getSignature(), methodSubSignature);
        this.dummyMain.setImplementationSignature(methodSignature);
        this.dummyMain.setLineCol(0);
        (0, ArkMethodBuilder_1.checkAndUpdateMethod)(this.dummyMain, dummyMainClass);
        dummyMainClass.addMethod(this.dummyMain);
        let defaultMethods = [];
        for (const method of this.entryMethods) {
            if (method.getDeclaringArkClass().isDefaultArkClass() || method.isStatic()) {
                defaultMethods.push(method);
                continue;
            }
            const declaringArkClass = method.getDeclaringArkClass();
            let newLocal = null;
            for (const local of this.classLocalMap.values()) {
                if ((local?.getType()).getClassSignature() === declaringArkClass.getSignature()) {
                    newLocal = local;
                    break;
                }
            }
            if (!newLocal) {
                newLocal = new Local_1.Local('%' + this.tempLocalIndex, new Type_1.ClassType(declaringArkClass.getSignature()));
                this.tempLocalIndex++;
            }
            this.classLocalMap.set(method, newLocal);
        }
        for (const defaultMethod of defaultMethods) {
            this.classLocalMap.set(defaultMethod, null);
        }
        const localSet = new Set(Array.from(this.classLocalMap.values()).filter((value) => value !== null));
        const dummyBody = new ArkBody_1.ArkBody(localSet, this.createDummyMainCfg());
        this.dummyMain.setBody(dummyBody);
        this.addCfg2Stmt();
        this.scene.addToMethodsMap(this.dummyMain);
    }
    addStaticInit(dummyCfg, firstBlock) {
        let isStartingStmt = true;
        for (const method of this.scene.getStaticInitMethods()) {
            const staticInvokeExpr = new Expr_1.ArkStaticInvokeExpr(method.getSignature(), []);
            const invokeStmt = new Stmt_1.ArkInvokeStmt(staticInvokeExpr);
            if (isStartingStmt) {
                dummyCfg.setStartingStmt(invokeStmt);
                isStartingStmt = false;
            }
            firstBlock.addStmt(invokeStmt);
        }
    }
    addClassInit(firstBlock) {
        const locals = Array.from(new Set(this.classLocalMap.values()));
        for (const local of locals) {
            if (!local) {
                continue;
            }
            let clsType = local.getType();
            let cls = this.scene.getClass(clsType.getClassSignature());
            const assStmt = new Stmt_1.ArkAssignStmt(local, new Expr_1.ArkNewExpr(clsType));
            firstBlock.addStmt(assStmt);
            local.setDeclaringStmt(assStmt);
            let consMtd = cls.getMethodWithName(TSConst_1.CONSTRUCTOR_NAME);
            if (consMtd) {
                let ivkExpr = new Expr_1.ArkInstanceInvokeExpr(local, consMtd.getSignature(), []);
                let ivkStmt = new Stmt_1.ArkInvokeStmt(ivkExpr);
                firstBlock.addStmt(ivkStmt);
            }
        }
    }
    addParamInit(method, paramLocals, invokeBlock) {
        let paramIdx = 0;
        for (const param of method.getParameters()) {
            let paramType = param.getType();
            // In ArkIR from abc scenario, param type is undefined in some cases
            // Then try to get it from super class(SDK)
            // TODO - need handle method overload to get the correct method
            if (!paramType) {
                let superCls = method.getDeclaringArkClass().getSuperClass();
                let methodInSuperCls = superCls?.getMethodWithName(method.getName());
                if (methodInSuperCls) {
                    paramType = methodInSuperCls.getParameters()[paramIdx]?.getType();
                    method = methodInSuperCls;
                }
            }
            const paramLocal = new Local_1.Local('%' + this.tempLocalIndex++, paramType);
            paramLocals.push(paramLocal);
            if (paramType instanceof Type_1.ClassType) {
                const assStmt = new Stmt_1.ArkAssignStmt(paramLocal, new Expr_1.ArkNewExpr(paramType));
                paramLocal.setDeclaringStmt(assStmt);
                invokeBlock.addStmt(assStmt);
            }
            paramIdx++;
        }
    }
    addBranches(whileBlock, countLocal, dummyCfg) {
        let lastBlocks = [whileBlock];
        let count = 0;
        for (let method of this.entryMethods) {
            count++;
            const condition = new Expr_1.ArkConditionExpr(countLocal, new Constant_1.Constant(count.toString(), Type_1.NumberType.getInstance()), Expr_1.RelationalBinaryOperator.Equality);
            const ifStmt = new Stmt_1.ArkIfStmt(condition);
            const ifBlock = new BasicBlock_1.BasicBlock();
            ifBlock.addStmt(ifStmt);
            dummyCfg.addBlock(ifBlock);
            for (const block of lastBlocks) {
                ifBlock.addPredecessorBlock(block);
                block.addSuccessorBlock(ifBlock);
            }
            const invokeBlock = new BasicBlock_1.BasicBlock();
            const paramLocals = [];
            this.addParamInit(method, paramLocals, invokeBlock);
            const local = this.classLocalMap.get(method);
            let invokeExpr;
            if (local) {
                invokeExpr = new Expr_1.ArkInstanceInvokeExpr(local, method.getSignature(), paramLocals);
            }
            else {
                invokeExpr = new Expr_1.ArkStaticInvokeExpr(method.getSignature(), paramLocals);
            }
            const invokeStmt = new Stmt_1.ArkInvokeStmt(invokeExpr);
            invokeBlock.addStmt(invokeStmt);
            dummyCfg.addBlock(invokeBlock);
            ifBlock.addSuccessorBlock(invokeBlock);
            invokeBlock.addPredecessorBlock(ifBlock);
            lastBlocks = [ifBlock, invokeBlock];
        }
        for (const block of lastBlocks) {
            block.addSuccessorBlock(whileBlock);
            whileBlock.addPredecessorBlock(block);
        }
    }
    createDummyMainCfg() {
        const dummyCfg = new Cfg_1.Cfg();
        dummyCfg.setDeclaringMethod(this.dummyMain);
        const firstBlock = new BasicBlock_1.BasicBlock();
        this.addStaticInit(dummyCfg, firstBlock);
        this.addClassInit(firstBlock);
        const countLocal = new Local_1.Local('count', Type_1.NumberType.getInstance());
        const zero = ValueUtil_1.ValueUtil.getOrCreateNumberConst(0);
        const countAssignStmt = new Stmt_1.ArkAssignStmt(countLocal, zero);
        const truE = ValueUtil_1.ValueUtil.getBooleanConstant(true);
        const conditionTrue = new Expr_1.ArkConditionExpr(truE, zero, Expr_1.RelationalBinaryOperator.Equality);
        const whileStmt = new Stmt_1.ArkIfStmt(conditionTrue);
        firstBlock.addStmt(countAssignStmt);
        dummyCfg.addBlock(firstBlock);
        dummyCfg.setStartingStmt(firstBlock.getHead());
        const whileBlock = new BasicBlock_1.BasicBlock();
        whileBlock.addStmt(whileStmt);
        dummyCfg.addBlock(whileBlock);
        firstBlock.addSuccessorBlock(whileBlock);
        whileBlock.addPredecessorBlock(firstBlock);
        this.addBranches(whileBlock, countLocal, dummyCfg);
        const returnStmt = new Stmt_1.ArkReturnVoidStmt();
        const returnBlock = new BasicBlock_1.BasicBlock();
        returnBlock.addStmt(returnStmt);
        dummyCfg.addBlock(returnBlock);
        whileBlock.addSuccessorBlock(returnBlock);
        returnBlock.addPredecessorBlock(whileBlock);
        return dummyCfg;
    }
    addCfg2Stmt() {
        const cfg = this.dummyMain.getCfg();
        if (!cfg) {
            return;
        }
        for (const block of cfg.getBlocks()) {
            for (const stmt of block.getStmts()) {
                stmt.setCfg(cfg);
            }
        }
    }
    getDummyMain() {
        return this.dummyMain;
    }
    getEntryMethodsFromComponents() {
        const COMPONENT_BASE_CLASSES = ['CustomComponent', 'ViewPU'];
        let methods = [];
        this.scene
            .getClasses()
            .filter(cls => {
            if (COMPONENT_BASE_CLASSES.includes(cls.getSuperClassName())) {
                return true;
            }
            if (cls.hasDecorator('Component')) {
                return true;
            }
            return false;
        })
            .forEach(cls => {
            methods.push(...cls.getMethods().filter(mtd => entryMethodUtils_1.COMPONENT_LIFECYCLE_METHOD_NAME.includes(mtd.getName())));
        });
        return methods;
    }
    classInheritsAbility(arkClass) {
        const ABILITY_BASE_CLASSES = ['UIExtensionAbility', 'Ability', 'FormExtensionAbility', 'UIAbility', 'BackupExtensionAbility'];
        if (ABILITY_BASE_CLASSES.includes(arkClass.getSuperClassName())) {
            return true;
        }
        let superClass = arkClass.getSuperClass();
        while (superClass) {
            if (ABILITY_BASE_CLASSES.includes(superClass.getSuperClassName())) {
                return true;
            }
            superClass = superClass.getSuperClass();
        }
        return false;
    }
    getMethodsFromAllAbilities() {
        let methods = [];
        this.scene
            .getClasses()
            .filter(cls => this.classInheritsAbility(cls))
            .forEach(cls => {
            methods.push(...cls.getMethods().filter(mtd => entryMethodUtils_1.LIFECYCLE_METHOD_NAME.includes(mtd.getName())));
        });
        return methods;
    }
    getCallbackMethods() {
        const callbackMethods = [];
        this.scene.getMethods().forEach(method => {
            if (!method.getCfg()) {
                return;
            }
            method
                .getCfg()
                .getStmts()
                .forEach(stmt => {
                const cbMethod = (0, entryMethodUtils_1.getCallbackMethodFromStmt)(stmt, this.scene);
                if (cbMethod && !callbackMethods.includes(cbMethod)) {
                    callbackMethods.push(cbMethod);
                }
            });
        });
        return callbackMethods;
    }
}
exports.DummyMainCreater = DummyMainCreater;
//# sourceMappingURL=DummyMainCreater.js.map