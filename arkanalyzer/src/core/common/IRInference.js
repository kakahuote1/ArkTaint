"use strict";
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
exports.IRInference = void 0;
/*
 * Copyright (c) 2024-2026 Huawei Device Co., Ltd.
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
const ArkMethod_1 = require("../model/ArkMethod");
const Type_1 = require("../base/Type");
const Local_1 = require("../base/Local");
const TypeInference_1 = require("./TypeInference");
const Expr_1 = require("../base/Expr");
const logger_1 = __importStar(require("../../utils/logger"));
const ArkClass_1 = require("../model/ArkClass");
const ModelUtils_1 = require("./ModelUtils");
const ArkField_1 = require("../model/ArkField");
const ArkSignature_1 = require("../model/ArkSignature");
const TSConst_1 = require("./TSConst");
const Builtin_1 = require("./Builtin");
const Stmt_1 = require("../base/Stmt");
const Ref_1 = require("../base/Ref");
const Constant_1 = require("../base/Constant");
const Const_1 = require("./Const");
const ValueUtil_1 = require("./ValueUtil");
const TypeExpr_1 = require("../base/TypeExpr");
const ArkBaseModel_1 = require("../model/ArkBaseModel");
const SdkUtils_1 = require("./SdkUtils");
const logger = logger_1.default.getLogger(logger_1.LOG_MODULE_TYPE.ARKANALYZER, 'IRInference');
class IRInference {
    static inferExportInfos(file) {
        file.getExportInfos().forEach(exportInfo => {
            if (exportInfo.getArkExport() === undefined) {
                let arkExport = (0, ModelUtils_1.findArkExport)(exportInfo);
                exportInfo.setArkExport(arkExport);
                if (arkExport) {
                    exportInfo.setExportClauseType(arkExport.getExportType());
                }
            }
        });
        file.getNamespaces().forEach(namespace => {
            namespace.getExportInfos().forEach(exportInfo => {
                if (exportInfo.getArkExport() === undefined) {
                    let arkExport = (0, ModelUtils_1.findArkExport)(exportInfo);
                    exportInfo.setArkExport(arkExport);
                    arkExport !== null ? exportInfo.setExportClauseType(arkExport.getExportType()) : true;
                }
            });
        });
    }
    static inferImportInfos(file) {
        file.getImportInfos().forEach(importInfo => {
            importInfo.getLazyExportInfo();
        });
    }
    static inferFile(file) {
        this.inferImportInfos(file);
        ModelUtils_1.ModelUtils.getAllClassesInFile(file).forEach(arkClass => {
            TypeInference_1.TypeInference.inferGenericType(arkClass.getGenericsTypes(), arkClass);
            arkClass.getAllHeritageClasses();
            arkClass.getFields().forEach(arkField => TypeInference_1.TypeInference.inferTypeInArkField(arkField));
            const methods = arkClass.getMethods().sort((a, b) => {
                const name = a.getName().split(Const_1.NAME_DELIMITER).reverse().join();
                const anotherName = b.getName().split(Const_1.NAME_DELIMITER).reverse().join();
                if (name.startsWith(anotherName)) {
                    return 1;
                }
                else if (anotherName.startsWith(name)) {
                    return -1;
                }
                return 0;
            });
            methods.forEach(arkMethod => TypeInference_1.TypeInference.inferTypeInMethod(arkMethod));
        });
        this.inferExportInfos(file);
    }
    static needInfer(fileSignature) {
        if (fileSignature === Builtin_1.Builtin.BUILT_IN_CLASSES_FILE_SIGNATURE) {
            return true;
        }
        return fileSignature.getFileName() === Const_1.UNKNOWN_FILE_NAME;
    }
    static inferStaticInvokeExpr(expr, arkMethod) {
        const fileSignature = expr.getMethodSignature().getDeclaringClassSignature().getDeclaringFileSignature();
        if (fileSignature !== ArkSignature_1.FileSignature.DEFAULT && fileSignature !== Builtin_1.Builtin.BUILT_IN_CLASSES_FILE_SIGNATURE) {
            return expr;
        }
        const arkClass = arkMethod.getDeclaringArkClass();
        const methodName = expr.getMethodSignature().getMethodSubSignature().getMethodName();
        expr.getArgs().forEach(arg => TypeInference_1.TypeInference.inferValueType(arg, arkMethod));
        if (methodName === TSConst_1.IMPORT) {
            const arg = expr.getArg(0);
            let type;
            if (arg instanceof Constant_1.Constant) {
                type = TypeInference_1.TypeInference.inferDynamicImportType(arg.getValue(), arkClass);
            }
            if (type) {
                expr.getMethodSignature().getMethodSubSignature().setReturnType(type);
            }
            return expr;
        }
        else if (methodName === TSConst_1.SUPER_NAME) {
            const superClass = arkClass.getSuperClass();
            if (superClass !== null) {
                const newMethodSignature = new ArkSignature_1.MethodSignature(superClass.getSignature(), expr.getMethodSignature().getMethodSubSignature());
                expr.setMethodSignature(newMethodSignature);
            }
            return expr;
        }
        const className = expr.getMethodSignature().getDeclaringClassSignature().getClassName();
        if (className && className !== Const_1.UNKNOWN_CLASS_NAME) {
            const baseType = TypeInference_1.TypeInference.inferBaseType(className, arkClass);
            if (baseType) {
                let result = this.inferInvokeExpr(expr, baseType, methodName, arkClass.getDeclaringArkFile().getScene());
                if (result) {
                    this.inferArgs(result, arkMethod);
                    return result;
                }
            }
            return expr;
        }
        return this.inferStaticInvokeExprByMethodName(methodName, arkMethod, expr);
    }
    static inferStaticInvokeExprByMethodName(methodName, arkMethod, expr) {
        const arkClass = arkMethod.getDeclaringArkClass();
        const arkExport = ModelUtils_1.ModelUtils.getStaticMethodWithName(methodName, arkClass) ??
            arkMethod.getFunctionLocal(methodName) ??
            ModelUtils_1.ModelUtils.findDeclaredLocal(new Local_1.Local(methodName), arkMethod) ??
            ModelUtils_1.ModelUtils.getArkExportInImportInfoWithName(methodName, arkClass.getDeclaringArkFile()) ??
            arkClass.getDeclaringArkFile().getScene().getSdkGlobal(methodName);
        let method;
        let signature;
        if (arkExport instanceof ArkMethod_1.ArkMethod) {
            method = arkExport;
        }
        else if (arkExport instanceof ArkClass_1.ArkClass) {
            method = arkExport.getMethodWithName(Const_1.CALL_SIGNATURE_NAME);
        }
        else {
            const arkExportType = TypeInference_1.TypeInference.parseArkExport2Type(arkExport);
            if (!arkExportType) {
                return expr;
            }
            const type = TypeInference_1.TypeInference.replaceAliasType(arkExportType);
            if (type instanceof Type_1.ClassType) {
                const cls = arkClass.getDeclaringArkFile().getScene().getClass(type.getClassSignature());
                method = cls?.getMethodWithName(Const_1.CALL_SIGNATURE_NAME);
            }
            else if (type instanceof Type_1.FunctionType) {
                signature = type.getMethodSignature();
            }
        }
        if (method) {
            signature = method.matchMethodSignature(expr.getArgs());
            TypeInference_1.TypeInference.inferSignatureReturnType(signature, method);
        }
        if (signature) {
            if (arkExport instanceof Local_1.Local) {
                expr = new Expr_1.ArkPtrInvokeExpr(signature, arkExport, expr.getArgs(), expr.getRealGenericTypes());
            }
            else {
                expr.setMethodSignature(signature);
            }
            this.inferArgs(expr, arkMethod);
        }
        return expr;
    }
    static inferInstanceInvokeExpr(expr, arkMethod) {
        const arkClass = arkMethod.getDeclaringArkClass();
        TypeInference_1.TypeInference.inferRealGenericTypes(expr.getRealGenericTypes(), arkClass);
        this.inferBase(expr, arkMethod);
        const baseType = TypeInference_1.TypeInference.replaceAliasType(expr.getBase().getType());
        let methodName = expr.getMethodSignature().getMethodSubSignature().getMethodName();
        if (methodName === TSConst_1.CONSTRUCTOR_NAME &&
            expr.getMethodSignature().getDeclaringClassSignature().getDeclaringFileSignature().getFileName() !== Const_1.UNKNOWN_FILE_NAME) {
            return expr;
        }
        if (methodName.startsWith(Const_1.NAME_PREFIX)) {
            const declaringStmt = arkMethod.getBody()?.getLocals().get(methodName)?.getDeclaringStmt();
            if (declaringStmt instanceof Stmt_1.ArkAssignStmt && declaringStmt.getRightOp() instanceof Ref_1.ArkInstanceFieldRef) {
                const rightOp = declaringStmt.getRightOp();
                methodName = rightOp.getBase().getName() + '.' + rightOp.getFieldName();
            }
        }
        const scene = arkClass.getDeclaringArkFile().getScene();
        if (methodName === 'forEach' && baseType instanceof Type_1.ArrayType) {
            this.processForEach(expr.getArg(0), baseType, scene);
            return expr;
        }
        expr.getArgs().forEach(arg => TypeInference_1.TypeInference.inferValueType(arg, arkMethod));
        let result = this.inferInvokeExpr(expr, baseType, methodName, scene);
        if (result) {
            this.inferArgs(result, arkMethod);
            return result;
        }
        logger.warn('invoke ArkInstanceInvokeExpr MethodSignature type fail: ', expr.toString());
        return expr;
    }
    static inferFieldRef(ref, arkMethod) {
        this.inferBase(ref, arkMethod);
        const baseType = TypeInference_1.TypeInference.replaceAliasType(ref.getBase().getType());
        if (baseType instanceof Type_1.ArrayType && ref.getFieldName() !== 'length') {
            return new Ref_1.ArkArrayRef(ref.getBase(), ValueUtil_1.ValueUtil.createConst(ref.getFieldName()));
        }
        let newFieldSignature = this.generateNewFieldSignature(ref, arkMethod.getDeclaringArkClass(), baseType);
        if (newFieldSignature) {
            if (newFieldSignature.isStatic()) {
                return new Ref_1.ArkStaticFieldRef(newFieldSignature);
            }
            ref.setFieldSignature(newFieldSignature);
        }
        return ref;
    }
    static inferBase(instance, arkMethod) {
        const base = instance.getBase();
        if (base.getName() === TSConst_1.THIS_NAME) {
            const name = instance instanceof Ref_1.ArkInstanceFieldRef ? instance.getFieldName() :
                instance.getMethodSignature().getMethodSubSignature().getMethodName();
            if (name.includes('.')) {
                return;
            }
            const declaringArkClass = arkMethod.getDeclaringArkClass();
            if (declaringArkClass.isAnonymousClass()) {
                let newBase = this.inferThisLocal(arkMethod);
                if (newBase) {
                    instance.setBase(newBase);
                }
            }
            else if (base.getType() instanceof Type_1.UnknownType) {
                base.setType(new Type_1.ClassType(declaringArkClass.getSignature(), declaringArkClass.getRealTypes()));
            }
        }
        else {
            this.inferLocal(instance.getBase(), arkMethod);
        }
    }
    static inferThisLocal(arkMethod) {
        const arkClass = arkMethod.getDeclaringArkClass();
        if (!arkClass.isAnonymousClass()) {
            return null;
        }
        const value = arkMethod.getBody()?.getUsedGlobals()?.get(TSConst_1.THIS_NAME);
        if (value instanceof Local_1.Local) {
            return value;
        }
        else {
            const thisType = TypeInference_1.TypeInference.inferBaseType(arkClass.getSignature().getDeclaringClassName(), arkClass);
            if (thisType instanceof Type_1.ClassType) {
                const newBase = new Local_1.Local(TSConst_1.THIS_NAME, thisType);
                let usedGlobals = arkMethod.getBody()?.getUsedGlobals();
                if (!usedGlobals) {
                    usedGlobals = new Map();
                    arkMethod.getBody()?.setUsedGlobals(usedGlobals);
                }
                usedGlobals.set(TSConst_1.THIS_NAME, newBase);
                return newBase;
            }
        }
        return null;
    }
    static inferArgs(expr, arkMethod) {
        const scene = arkMethod.getDeclaringArkFile().getScene();
        const parameters = expr.getMethodSignature().getMethodSubSignature().getParameters();
        let realTypes = [];
        const len = expr.getArgs().length;
        for (let index = 0; index < len; index++) {
            const arg = expr.getArg(index);
            if (index >= parameters.length) {
                break;
            }
            const argType = arg.getType();
            const paramType = parameters[index].getType();
            this.inferArg(expr, argType, paramType, scene, realTypes);
        }
        if (realTypes.length > 0 && !expr.getRealGenericTypes()) {
            expr.setRealGenericTypes(realTypes);
        }
    }
    static inferArg(expr, argType, paramType, scene, realTypes) {
        if (paramType instanceof Type_1.UnionType) {
            paramType.getTypes().forEach(t => this.inferArg(expr, argType, t, scene, realTypes));
        }
        else if (paramType instanceof Type_1.AliasType) {
            this.inferArg(expr, argType, paramType.getOriginalType(), scene, realTypes);
        }
        else if (paramType instanceof Type_1.ArrayType && argType instanceof Type_1.ArrayType) {
            this.inferArg(expr, argType.getBaseType(), paramType.getBaseType(), scene, realTypes);
        }
        else if (expr instanceof Expr_1.ArkInstanceInvokeExpr && expr.getBase().getType() instanceof Type_1.ArrayType) {
            if (paramType instanceof Type_1.ArrayType && paramType.getBaseType() instanceof Type_1.GenericType) {
                this.inferArg(expr, argType, expr.getBase().getType().getBaseType(), scene, realTypes);
            }
        }
        if (paramType instanceof Type_1.ClassType && scene.getProjectSdkMap().has(paramType.getClassSignature().getDeclaringFileSignature().getProjectName())) {
            this.inferArgTypeWithSdk(paramType, scene, argType);
        }
        else if (paramType instanceof Type_1.GenericType) {
            if (!realTypes[paramType.getIndex()]) {
                realTypes[paramType.getIndex()] = argType;
            }
        }
        else if (paramType instanceof Type_1.AnyType) {
            realTypes.push(argType);
        }
        else if (paramType instanceof Type_1.FunctionType && argType instanceof Type_1.FunctionType) {
            TypeInference_1.TypeInference.inferFunctionType(argType, paramType.getMethodSignature().getMethodSubSignature(), expr.getRealGenericTypes());
        }
    }
    static inferRightWithSdkType(leftType, rightType, ackClass) {
        if (leftType instanceof Type_1.AliasType) {
            this.inferRightWithSdkType(TypeInference_1.TypeInference.replaceAliasType(leftType), rightType, ackClass);
        }
        else if (leftType instanceof Type_1.UnionType) {
            leftType.getTypes().forEach(t => this.inferRightWithSdkType(t, rightType, ackClass));
        }
        else if (leftType instanceof Type_1.ClassType) {
            IRInference.inferArgTypeWithSdk(leftType, ackClass.getDeclaringArkFile().getScene(), rightType);
        }
        else if (rightType instanceof Type_1.ArrayType && leftType instanceof Type_1.ArrayType) {
            const baseType = TypeInference_1.TypeInference.replaceAliasType(leftType.getBaseType());
            if (baseType instanceof Type_1.ClassType) {
                IRInference.inferArgTypeWithSdk(baseType, ackClass.getDeclaringArkFile().getScene(), rightType.getBaseType());
            }
        }
        else if (rightType instanceof Type_1.FunctionType && leftType instanceof Type_1.FunctionType) {
            TypeInference_1.TypeInference.inferFunctionType(rightType, leftType.getMethodSignature().getMethodSubSignature(), undefined);
        }
    }
    static inferArgTypeWithSdk(sdkType, scene, argType) {
        const sdkProjectName = sdkType.getClassSignature().getDeclaringFileSignature().getProjectName();
        const className = sdkType.getClassSignature().getClassName();
        // When leftOp is local with Function annotation, the rightOp is a lambda function, which should be inferred as method later.
        if (!scene.getProjectSdkMap().has(sdkProjectName) || (sdkProjectName === SdkUtils_1.SdkUtils.BUILT_IN_NAME && className === 'Function')) {
            return;
        }
        if (argType instanceof Type_1.UnionType) {
            argType.getTypes().forEach(t => this.inferArgTypeWithSdk(sdkType, scene, t));
        }
        else if (argType instanceof Type_1.ClassType && argType.getClassSignature().getClassName().startsWith(Const_1.ANONYMOUS_CLASS_PREFIX)) {
            this.inferAnonymousClass(scene.getClass(argType.getClassSignature()), sdkType.getClassSignature());
        }
        else if (argType instanceof Type_1.FunctionType) {
            const param = scene.getClass(sdkType.getClassSignature())?.getMethodWithName(Const_1.CALL_SIGNATURE_NAME)?.getSignature().getMethodSubSignature();
            const realTypes = sdkType.getRealGenericTypes();
            TypeInference_1.TypeInference.inferFunctionType(argType, param, realTypes);
        }
    }
    static inferInvokeExpr(expr, baseType, methodName, scene) {
        if (baseType instanceof Type_1.AliasType) {
            return this.inferInvokeExpr(expr, baseType.getOriginalType(), methodName, scene);
        }
        else if (baseType instanceof Type_1.UnionType) {
            for (let type of baseType.flatType()) {
                if (type instanceof Type_1.UndefinedType || type instanceof Type_1.NullType) {
                    continue;
                }
                let result = this.inferInvokeExpr(expr, type, methodName, scene);
                if (result) {
                    return result;
                }
            }
        }
        if (baseType instanceof Type_1.ClassType) {
            return this.inferInvokeExprWithDeclaredClass(expr, baseType, methodName, scene);
        }
        else if (baseType instanceof Type_1.AnnotationNamespaceType) {
            const namespace = scene.getNamespace(baseType.getNamespaceSignature());
            if (namespace) {
                const foundMethod = ModelUtils_1.ModelUtils.findPropertyInNamespace(methodName, namespace);
                if (foundMethod instanceof ArkMethod_1.ArkMethod) {
                    let signature = foundMethod.matchMethodSignature(expr.getArgs());
                    TypeInference_1.TypeInference.inferSignatureReturnType(signature, foundMethod);
                    expr.setMethodSignature(signature);
                    return expr instanceof Expr_1.ArkInstanceInvokeExpr ? new Expr_1.ArkStaticInvokeExpr(signature, expr.getArgs(), expr.getRealGenericTypes()) : expr;
                }
            }
        }
        else if (baseType instanceof Type_1.FunctionType) {
            return IRInference.inferInvokeExprWithFunction(methodName, expr, baseType, scene);
        }
        else if (baseType instanceof Type_1.ArrayType) {
            return IRInference.inferInvokeExprWithArray(methodName, expr, baseType, scene);
        }
        return null;
    }
    static inferInvokeExprWithArray(methodName, expr, baseType, scene) {
        const arrayInterface = scene.getSdkGlobal(Builtin_1.Builtin.ARRAY);
        if (arrayInterface instanceof ArkClass_1.ArkClass) {
            return this.inferInvokeExpr(expr, new Type_1.ClassType(arrayInterface.getSignature(), [baseType.getBaseType()]), methodName, scene);
        }
        else if (methodName === Builtin_1.Builtin.ITERATOR_FUNCTION) {
            expr.getMethodSignature().getMethodSubSignature().setReturnType(Builtin_1.Builtin.ITERATOR_CLASS_TYPE);
            expr.setRealGenericTypes([baseType.getBaseType()]);
            return expr;
        }
        return null;
    }
    static inferInvokeExprWithFunction(methodName, expr, baseType, scene) {
        if (methodName === Const_1.CALL_SIGNATURE_NAME) {
            expr.setMethodSignature(baseType.getMethodSignature());
            return expr;
        }
        const funcInterface = scene.getSdkGlobal(TSConst_1.FUNCTION);
        if (funcInterface instanceof ArkClass_1.ArkClass) {
            const method = ModelUtils_1.ModelUtils.findPropertyInClass(methodName, funcInterface);
            if (method instanceof ArkMethod_1.ArkMethod) {
                expr.setRealGenericTypes([baseType]);
                expr.setMethodSignature(method.getSignature());
                return expr;
            }
        }
        return null;
    }
    static inferInvokeExprWithDeclaredClass(expr, baseType, methodName, scene) {
        const result = this.inferSpecialMethod(expr, baseType, methodName);
        if (result) {
            return result;
        }
        let declaredClass = scene.getClass(baseType.getClassSignature()) ?? scene.getSdkGlobal(baseType.getClassSignature().getClassName());
        if (!(declaredClass instanceof ArkClass_1.ArkClass)) {
            return null;
        }
        let method;
        if (methodName === TSConst_1.CONSTRUCTOR_NAME) {
            method = declaredClass?.getMethodWithName('construct-signature') ??
                declaredClass.getMethodWithName(Const_1.CALL_SIGNATURE_NAME) ?? declaredClass?.getMethodWithName(TSConst_1.CONSTRUCTOR_NAME);
            if (!method) {
                const subSignature = new ArkSignature_1.MethodSubSignature(methodName, [], new Type_1.ClassType(baseType.getClassSignature()));
                expr.setMethodSignature(new ArkSignature_1.MethodSignature(baseType.getClassSignature(), subSignature));
                return expr;
            }
        }
        else {
            const member = ModelUtils_1.ModelUtils.findPropertyInClass(methodName, declaredClass);
            method = member instanceof ArkClass_1.ArkClass ? member.getMethodWithName(Const_1.CALL_SIGNATURE_NAME) ?? member.getMethodWithName(TSConst_1.CONSTRUCTOR_NAME) : member;
        }
        if (method instanceof ArkMethod_1.ArkMethod) {
            const methodSignature = method.matchMethodSignature(expr.getArgs());
            TypeInference_1.TypeInference.inferSignatureReturnType(methodSignature, method);
            expr.setMethodSignature(this.replaceMethodSignature(expr.getMethodSignature(), methodSignature));
            expr.setRealGenericTypes(IRInference.getRealTypes(expr, declaredClass, baseType, method));
            if (expr instanceof Expr_1.ArkInstanceInvokeExpr && (method.isStatic() || method.getDeclaringArkClass().isDefaultArkClass())) {
                return new Expr_1.ArkStaticInvokeExpr(methodSignature, expr.getArgs(), expr.getRealGenericTypes());
            }
            return expr;
        }
        else if (method instanceof ArkField_1.ArkField || method instanceof Local_1.Local) {
            return this.changePtrInvokeExpr(method, scene, expr) ?? expr;
        }
        return null;
    }
    static inferSpecialMethod(expr, baseType, methodName) {
        if (methodName === Builtin_1.Builtin.ITERATOR_NEXT &&
            baseType.getClassSignature().getDeclaringFileSignature().getProjectName() === Builtin_1.Builtin.DUMMY_PROJECT_NAME) {
            expr.getMethodSignature().getMethodSubSignature().setReturnType(Builtin_1.Builtin.ITERATOR_RESULT_CLASS_TYPE);
            expr.setRealGenericTypes(baseType.getRealGenericTypes());
            return expr;
        }
        return null;
    }
    static changePtrInvokeExpr(method, scene, expr) {
        let type = method.getType();
        if (type instanceof Type_1.UnionType) {
            const funType = type.getTypes().find(t => t instanceof Type_1.FunctionType);
            if (funType instanceof Type_1.FunctionType) {
                type = funType;
            }
            else {
                type = type.getTypes().find(t => t instanceof Type_1.ClassType);
            }
        }
        let methodSignature;
        if (type instanceof Type_1.FunctionType) {
            methodSignature = type.getMethodSignature();
        }
        else if (type instanceof Type_1.ClassType) {
            const methodName = type.getClassSignature().getClassName() === TSConst_1.FUNCTION ? TSConst_1.CALL : Const_1.CALL_SIGNATURE_NAME;
            const callback = scene.getClass(type.getClassSignature())?.getMethodWithName(methodName);
            if (callback) {
                methodSignature = callback.getSignature();
            }
        }
        if (methodSignature) {
            const ptr = method instanceof Local_1.Local ? method :
                expr instanceof Expr_1.ArkInstanceInvokeExpr
                    ? new Ref_1.ArkInstanceFieldRef(expr.getBase(), method.getSignature())
                    : new Ref_1.ArkStaticFieldRef(method.getSignature());
            return new Expr_1.ArkPtrInvokeExpr(methodSignature, ptr, expr.getArgs(), expr.getRealGenericTypes());
        }
        return null;
    }
    static getRealTypes(expr, declaredClass, baseType, method) {
        let realTypes;
        const tmp = [];
        if (method.getGenericTypes()) {
            expr.getMethodSignature().getMethodSubSignature().getParameters()
                .filter(p => !p.getName().startsWith(Const_1.LEXICAL_ENV_NAME_PREFIX))
                .forEach((p, i) => {
                if (TypeInference_1.TypeInference.checkType(p.getType(), t => t instanceof Type_1.GenericType)) {
                    tmp.push(expr.getArg(i).getType());
                }
            });
        }
        if (tmp.length > 0) {
            realTypes = tmp;
        }
        else if (declaredClass?.hasComponentDecorator()) {
            realTypes = [new Type_1.ClassType(declaredClass?.getSignature())];
        }
        else {
            realTypes = baseType.getRealGenericTypes() ?? declaredClass?.getRealTypes();
        }
        return realTypes;
    }
    static replaceMethodSignature(init, declared) {
        const className = init.getDeclaringClassSignature().getClassName();
        let classSignature;
        if (declared.getDeclaringClassSignature().getClassName().endsWith('Interface')) {
            classSignature = new ArkSignature_1.AliasClassSignature(className, declared.getDeclaringClassSignature());
        }
        let newSubSignature;
        if (classSignature || newSubSignature) {
            return new ArkSignature_1.MethodSignature(classSignature ?? declared.getDeclaringClassSignature(), newSubSignature ?? declared.getMethodSubSignature());
        }
        return declared;
    }
    static processForEach(arg, baseType, scene) {
        const argType = arg.getType();
        if (argType instanceof Type_1.FunctionType) {
            const argMethodSignature = argType.getMethodSignature();
            const argMethod = scene.getMethod(argMethodSignature);
            if (argMethod != null && argMethod.getBody()) {
                const body = argMethod.getBody();
                const firstStmt = body.getCfg().getStartingStmt();
                if (firstStmt instanceof Stmt_1.ArkAssignStmt && firstStmt.getRightOp() instanceof Ref_1.ArkParameterRef) {
                    const parameterRef = firstStmt.getRightOp();
                    parameterRef.setType(baseType.getBaseType());
                    const argMethodParams = argMethod.getSignature().getMethodSubSignature().getParameters();
                    const actualParam = argMethodParams[argMethodParams.length - 1];
                    actualParam.setType(baseType.getBaseType());
                }
                TypeInference_1.TypeInference.inferTypeInMethod(argMethod);
            }
        }
        else {
            logger.warn(`arg of forEach must be callable`);
        }
    }
    static inferLocal(base, arkMethod) {
        const arkClass = arkMethod.getDeclaringArkClass();
        let baseType = base.getType();
        if (baseType instanceof Type_1.UnclearReferenceType) {
            baseType = TypeInference_1.TypeInference.inferUnclearRefName(baseType.getName(), arkClass);
        }
        else if (TypeInference_1.TypeInference.isUnclearType(baseType)) {
            const declaringStmt = base.getDeclaringStmt();
            if (!declaringStmt || !declaringStmt.getOriginalText() || declaringStmt.getOriginalText()?.startsWith(base.getName())) {
                baseType = ModelUtils_1.ModelUtils.findDeclaredLocal(base, arkMethod)?.getType() ?? TypeInference_1.TypeInference.inferBaseType(base.getName(), arkClass);
            }
        }
        if (baseType instanceof Type_1.UnionType || (baseType && !TypeInference_1.TypeInference.isUnclearType(baseType))) {
            base.setType(baseType);
        }
    }
    static inferInstanceMember(baseType, value, arkMethod, inferMember) {
        if (baseType instanceof Type_1.PrimitiveType) {
            // Convert primitive types to their wrapper class types
            const name = baseType instanceof Type_1.LiteralType ? typeof baseType.getLiteralName() : baseType.getName();
            const className = baseType instanceof Type_1.BigIntType ? Builtin_1.Builtin.BIGINT : name.charAt(0).toUpperCase() + name.slice(1);
            const arrayClass = arkMethod.getDeclaringArkFile().getScene().getSdkGlobal(className);
            if (arrayClass instanceof ArkClass_1.ArkClass) {
                return inferMember(new Type_1.ClassType(arrayClass.getSignature(), arrayClass.getRealTypes()), value, arkMethod);
            }
        }
        else if (baseType instanceof Type_1.EnumValueType) {
            const newType = baseType.getConstant()?.getType();
            return newType ? IRInference.inferInstanceMember(newType, value, arkMethod, inferMember) : null;
        }
        else if (baseType instanceof Type_1.AliasType) {
            return IRInference.inferInstanceMember(TypeInference_1.TypeInference.replaceAliasType(baseType), value, arkMethod, inferMember);
        }
        else if (baseType instanceof Type_1.UnionType || baseType instanceof Type_1.IntersectionType) {
            for (let type of baseType.getTypes()) {
                if (type instanceof Type_1.UndefinedType || type instanceof Type_1.NullType) {
                    continue;
                }
                let result = IRInference.inferInstanceMember(type, value, arkMethod, inferMember);
                if (result) {
                    return result;
                }
            }
        }
        else if (baseType instanceof Type_1.GenericType) {
            const newType = baseType.getDefaultType() ?? baseType.getConstraint();
            return newType ? IRInference.inferInstanceMember(newType, value, arkMethod, inferMember) : null;
        }
        return inferMember(baseType, value, arkMethod);
    }
    static generateNewFieldSignature(ref, arkClass, baseType) {
        if (baseType instanceof Type_1.UnionType) {
            for (let type of baseType.flatType()) {
                if (type instanceof Type_1.UndefinedType || type instanceof Type_1.NullType) {
                    continue;
                }
                let newFieldSignature = this.generateNewFieldSignature(ref, arkClass, type);
                if (!TypeInference_1.TypeInference.isUnclearType(newFieldSignature?.getType())) {
                    return newFieldSignature;
                }
            }
            return null;
        }
        else if (baseType instanceof Type_1.AliasType) {
            return this.generateNewFieldSignature(ref, arkClass, baseType.getOriginalType());
        }
        else if (baseType instanceof Type_1.ArrayType) {
            const arrayClass = arkClass.getDeclaringArkFile().getScene().getSdkGlobal(Builtin_1.Builtin.ARRAY);
            if (arrayClass instanceof ArkClass_1.ArkClass) {
                baseType = new Type_1.ClassType(arrayClass.getSignature(), [baseType.getBaseType()]);
            }
        }
        return IRInference.getFieldSignature(ref, baseType, arkClass);
    }
    static updateRefSignature(baseType, ref, arkMethod) {
        const fieldName = ref.getFieldName().replace(/[\"|\']/g, '');
        if (baseType instanceof Type_1.TupleType) {
            const n = Number(fieldName);
            if (!isNaN(n) && n < baseType.getTypes().length) {
                ref.getFieldSignature().setType(baseType.getTypes()[n]);
            }
            return ref;
        }
        else if (baseType instanceof Type_1.ArrayType) {
            if (ref instanceof Ref_1.ArkInstanceFieldRef && ref.isDynamic()) {
                const index = TypeInference_1.TypeInference.getLocalFromMethodBody(fieldName, arkMethod);
                return new Ref_1.ArkArrayRef(ref.getBase(), index ?? ValueUtil_1.ValueUtil.createConst(fieldName));
            }
            else {
                const arrayClass = arkMethod.getDeclaringArkFile().getScene().getSdkGlobal(Builtin_1.Builtin.ARRAY);
                if (arrayClass instanceof ArkClass_1.ArkClass) {
                    baseType = new Type_1.ClassType(arrayClass.getSignature(), [baseType.getBaseType()]);
                }
            }
        }
        else if (baseType instanceof Type_1.FunctionType) {
            const arrayClass = arkMethod.getDeclaringArkFile().getScene().getSdkGlobal(Builtin_1.Builtin.FUNCTION);
            if (arrayClass instanceof ArkClass_1.ArkClass) {
                baseType = new Type_1.ClassType(arrayClass.getSignature());
            }
        }
        let { staticFlag, signature, value } = IRInference.genFieldSignature(fieldName, baseType, ref, arkMethod);
        if (value) {
            return value;
        }
        if (!signature) {
            return null;
        }
        if (staticFlag) {
            return new Ref_1.ArkStaticFieldRef(signature);
        }
        else {
            ref.setFieldSignature(signature);
            return ref;
        }
    }
    static genFieldSignature(fieldName, baseType, ref, arkMethod) {
        const arkClass = arkMethod.getDeclaringArkClass();
        const propertyAndType = TypeInference_1.TypeInference.inferFieldType(baseType, fieldName, arkClass);
        let propertyType = IRInference.repairType(propertyAndType?.[1], fieldName, arkClass);
        let staticFlag = false;
        let signature = null;
        if (baseType instanceof Type_1.ClassType) {
            const property = propertyAndType?.[0] ?? IRInference.findPropertyFormChildrenClass(fieldName, arkClass, baseType);
            if (property instanceof ArkMethod_1.ArkMethod && property.getName().startsWith(Const_1.GETTER_PREFIX) && ref instanceof Ref_1.ArkInstanceFieldRef) {
                const expr = property.isStatic() ? new Expr_1.ArkStaticInvokeExpr(property.getSignature(), [])
                    : new Expr_1.ArkInstanceInvokeExpr(ref.getBase(), property.getSignature(), []);
                return { staticFlag: staticFlag, signature: signature, value: expr };
            }
            staticFlag = baseType.getClassSignature().getClassName() === Const_1.DEFAULT_ARK_CLASS_NAME ||
                ((property instanceof ArkField_1.ArkField || property instanceof ArkMethod_1.ArkMethod) && property.isStatic());
            if (property instanceof ArkField_1.ArkField && property.getCategory() !== ArkField_1.FieldCategory.ENUM_MEMBER &&
                !(property.getType() instanceof Type_1.GenericType)) {
                signature = property.getSignature();
            }
            else {
                const baseSignature = property instanceof ArkMethod_1.ArkMethod ? property.getSignature().getDeclaringClassSignature() : baseType.getClassSignature();
                signature = new ArkSignature_1.FieldSignature(fieldName, baseSignature, propertyType ?? ref.getType(), staticFlag);
            }
        }
        else if (baseType instanceof Type_1.AnnotationNamespaceType) {
            staticFlag = true;
            signature = new ArkSignature_1.FieldSignature(fieldName, baseType.getNamespaceSignature(), propertyType ?? ref.getType(), staticFlag);
        }
        return { staticFlag, signature };
    }
    static getFieldSignature(ref, baseType, arkClass) {
        const fieldName = ref.getFieldName().replace(/[\"|\']/g, '');
        const propertyAndType = TypeInference_1.TypeInference.inferFieldType(baseType, fieldName, arkClass);
        let propertyType = IRInference.repairType(propertyAndType?.[1], fieldName, arkClass);
        let staticFlag;
        let signature;
        if (baseType instanceof Type_1.ClassType) {
            let property = propertyAndType?.[0];
            if (!property) {
                const subField = this.findPropertyFormChildrenClass(fieldName, arkClass, baseType);
                if (subField) {
                    property = subField;
                }
            }
            else if (property instanceof ArkField_1.ArkField && property.getCategory() !== ArkField_1.FieldCategory.ENUM_MEMBER &&
                !(property.getType() instanceof Type_1.GenericType)) {
                return property.getSignature();
            }
            staticFlag = baseType.getClassSignature().getClassName() === Const_1.DEFAULT_ARK_CLASS_NAME ||
                ((property instanceof ArkField_1.ArkField || property instanceof ArkMethod_1.ArkMethod) && property.isStatic());
            signature = property instanceof ArkMethod_1.ArkMethod ? property.getSignature().getDeclaringClassSignature() : baseType.getClassSignature();
        }
        else if (baseType instanceof Type_1.ArrayType) {
            const property = propertyAndType?.[0];
            return property instanceof ArkField_1.ArkField ? property.getSignature() : null;
        }
        else if (baseType instanceof Type_1.AnnotationNamespaceType) {
            staticFlag = true;
            signature = baseType.getNamespaceSignature();
        }
        else {
            return null;
        }
        return new ArkSignature_1.FieldSignature(fieldName, signature, propertyType ?? ref.getType(), staticFlag);
    }
    static findPropertyFormChildrenClass(fieldName, arkClass, baseType) {
        if (baseType.getClassSignature().getClassName() !== Const_1.DEFAULT_ARK_CLASS_NAME &&
            baseType.getClassSignature().getDeclaringFileSignature().getProjectName() !== Builtin_1.Builtin.DUMMY_PROJECT_NAME) {
            const iterator = arkClass.getDeclaringArkFile().getScene().getClass(baseType.getClassSignature())?.getExtendedClasses().values();
            if (!iterator) {
                return null;
            }
            let next = iterator.next();
            while (!next.done) {
                const subClass = next.value;
                const property = TypeInference_1.TypeInference.inferFieldType(new Type_1.ClassType(subClass.getSignature(), subClass.getRealTypes()), fieldName, subClass);
                if (property && property[0]) {
                    return property[0];
                }
                next = iterator.next();
            }
        }
        return null;
    }
    static repairType(propertyType, fieldName, arkClass) {
        if (!propertyType || propertyType instanceof Type_1.UnknownType) {
            const newType = TypeInference_1.TypeInference.inferBaseType(fieldName, arkClass);
            if (newType) {
                propertyType = newType;
            }
        }
        else if (TypeInference_1.TypeInference.isUnclearType(propertyType)) {
            const newType = TypeInference_1.TypeInference.inferUnclearedType(propertyType, arkClass);
            if (newType) {
                propertyType = newType;
            }
        }
        return propertyType;
    }
    static inferAnonymousClass(anon, declaredSignature, set = new Set()) {
        if (!anon) {
            return;
        }
        const key = anon.getSignature().toString();
        if (set.has(key)) {
            return;
        }
        else {
            set.add(key);
        }
        const scene = anon.getDeclaringArkFile().getScene();
        const declaredClass = scene.getClass(declaredSignature);
        if (!declaredClass) {
            return;
        }
        for (const anonField of anon.getFields()) {
            const property = ModelUtils_1.ModelUtils.findPropertyInClass(anonField.getName(), declaredClass);
            if (property instanceof ArkField_1.ArkField) {
                this.assignAnonField(property, anonField, scene, set);
            }
            else if (property instanceof ArkMethod_1.ArkMethod) {
                const type = anonField.getType();
                if (type instanceof Type_1.FunctionType) {
                    this.assignAnonMethod(scene.getMethod(type.getMethodSignature()), property);
                }
                if (type instanceof Type_1.UnknownType) {
                    anonField.setSignature(new ArkSignature_1.FieldSignature(anonField.getName(), property.getDeclaringArkClass().getSignature(), new Type_1.FunctionType(property.getSignature())));
                }
            }
        }
        for (const anonMethod of anon.getMethods()) {
            this.assignAnonMethod(anonMethod, declaredClass.getMethodWithName(anonMethod.getName()));
        }
    }
    static assignAnonMethod(anonMethod, declaredMethod) {
        if (declaredMethod && anonMethod) {
            anonMethod.setDeclareSignatures(declaredMethod.matchMethodSignature(anonMethod.getSubSignature().getParameters()));
        }
    }
    static assignAnonField(property, anonField, scene, set) {
        function deepInfer(anonType, declaredSignature) {
            if (anonType instanceof Type_1.ClassType && anonType.getClassSignature().getClassName().startsWith(Const_1.ANONYMOUS_CLASS_PREFIX)) {
                IRInference.inferAnonymousClass(scene.getClass(anonType.getClassSignature()), declaredSignature, set);
            }
        }
        const type = property.getSignature().getType();
        const fieldInitializer = anonField.getInitializer();
        const lastStmt = fieldInitializer[fieldInitializer.length - 1];
        if (lastStmt instanceof Stmt_1.ArkAssignStmt) {
            const rightType = lastStmt.getRightOp().getType();
            if (type instanceof Type_1.ClassType) {
                deepInfer(rightType, type.getClassSignature());
            }
            else if (type instanceof Type_1.ArrayType && type.getBaseType() instanceof Type_1.ClassType && rightType instanceof Type_1.ArrayType) {
                const baseType = rightType.getBaseType();
                const classSignature = type.getBaseType().getClassSignature();
                if (baseType instanceof Type_1.UnionType) {
                    baseType.getTypes().forEach(t => deepInfer(t, classSignature));
                }
                else {
                    deepInfer(rightType.getBaseType(), classSignature);
                }
            }
            else if (type instanceof Type_1.FunctionType && rightType instanceof Type_1.FunctionType) {
                TypeInference_1.TypeInference.inferFunctionType(rightType, type.getMethodSignature().getMethodSubSignature(), type.getRealGenericTypes());
            }
            const leftOp = lastStmt.getLeftOp();
            if (leftOp instanceof Ref_1.AbstractFieldRef) {
                leftOp.setFieldSignature(property.getSignature());
            }
        }
        anonField.setSignature(property.getSignature());
    }
    static inferAliasTypeExpr(expr, arkMethod) {
        const originalObject = expr.getOriginalObject();
        let model;
        if (originalObject instanceof Local_1.Local) {
            model = ModelUtils_1.ModelUtils.findArkModelByRefName(originalObject.getName(), arkMethod.getDeclaringArkClass());
        }
        else if (originalObject instanceof TypeExpr_1.AbstractTypeExpr) {
            originalObject.inferType(arkMethod);
            model = originalObject;
        }
        else if (originalObject instanceof Type_1.Type) {
            const type = TypeInference_1.TypeInference.inferUnclearedType(originalObject, arkMethod.getDeclaringArkClass());
            // If original Object is ClassType, AliasType or UnclearReferenceType with real generic types,
            // the type after infer should be revert back to the object itself.
            if (type instanceof Type_1.ClassType) {
                const scene = arkMethod.getDeclaringArkFile().getScene();
                model = ModelUtils_1.ModelUtils.findArkModelBySignature(type.getClassSignature(), scene);
            }
            else if (type instanceof Type_1.AliasType) {
                const scene = arkMethod.getDeclaringArkFile().getScene();
                model = ModelUtils_1.ModelUtils.findArkModelBySignature(type.getSignature(), scene);
            }
            else if (type) {
                model = type;
            }
            if (expr.getRealGenericTypes() !== undefined && originalObject instanceof Type_1.UnclearReferenceType) {
                expr.setRealGenericTypes(originalObject.getGenericTypes());
            }
        }
        if (Expr_1.AliasTypeExpr.isAliasTypeOriginalModel(model)) {
            expr.setOriginalObject(model);
        }
        return expr;
    }
    static inferTypeQueryExpr(expr, arkMethod) {
        let gTypes = expr.getGenerateTypes();
        if (gTypes) {
            for (let i = 0; i < gTypes.length; i++) {
                const newType = TypeInference_1.TypeInference.inferUnclearedType(gTypes[i], arkMethod.getDeclaringArkClass());
                if (newType) {
                    gTypes[i] = newType;
                }
            }
        }
        const opValue = expr.getOpValue();
        let opValueType;
        if (opValue instanceof ArkBaseModel_1.ArkBaseModel) {
            opValueType = ModelUtils_1.ModelUtils.parseArkBaseModel2Type(opValue) ?? Type_1.UnknownType.getInstance();
        }
        else {
            opValueType = opValue.getType();
        }
        if (!TypeInference_1.TypeInference.isUnclearType(opValueType)) {
            return;
        }
        if (opValue instanceof Local_1.Local) {
            const newOpValueType = TypeInference_1.TypeInference.inferBaseType(opValue.getName(), arkMethod.getDeclaringArkClass());
            const scene = arkMethod.getDeclaringArkFile().getScene();
            if (newOpValueType instanceof Type_1.ClassType) {
                const newOpValue = ModelUtils_1.ModelUtils.findArkModelBySignature(newOpValueType.getClassSignature(), scene);
                if (newOpValue instanceof ArkBaseModel_1.ArkBaseModel) {
                    expr.setOpValue(newOpValue);
                }
            }
            else if (newOpValueType instanceof Type_1.FunctionType) {
                const newOpValue = ModelUtils_1.ModelUtils.findArkModelBySignature(newOpValueType.getMethodSignature(), scene);
                if (newOpValue instanceof ArkBaseModel_1.ArkBaseModel) {
                    expr.setOpValue(newOpValue);
                }
            }
            else {
                this.inferLocal(opValue, arkMethod);
            }
        }
        else if (opValue instanceof Ref_1.AbstractRef || opValue instanceof Expr_1.AbstractExpr) {
            expr.setOpValue(opValue.inferType(arkMethod));
        }
    }
    static inferKeyofTypeExpr(expr, arkMethod) {
        const opType = expr.getOpType();
        if (TypeInference_1.TypeInference.isUnclearType(opType)) {
            if (opType instanceof TypeExpr_1.TypeQueryExpr) {
                this.inferTypeQueryExpr(opType, arkMethod);
            }
            else {
                const type = TypeInference_1.TypeInference.inferUnclearedType(opType, arkMethod.getDeclaringArkClass());
                if (type) {
                    expr.setOpType(type);
                }
            }
        }
    }
    static inferParameterRef(ref, arkMethod) {
        const paramType = ref.getType();
        if (paramType instanceof Type_1.UnknownType || paramType instanceof Type_1.UnclearReferenceType) {
            const signature = arkMethod.getDeclareSignatures()?.[0] ?? arkMethod.getSignature();
            const type1 = signature.getMethodSubSignature().getParameters()[ref.getIndex()]?.getType();
            if (!TypeInference_1.TypeInference.isUnclearType(type1)) {
                ref.setType(type1);
                return ref;
            }
        }
        else if (paramType instanceof Type_1.LexicalEnvType) {
            paramType
                .getClosures()
                .filter(c => TypeInference_1.TypeInference.isUnclearType(c.getType()))
                .forEach(e => this.inferLocal(e, arkMethod));
            return ref;
        }
        let type = TypeInference_1.TypeInference.inferUnclearedType(paramType, arkMethod.getDeclaringArkClass());
        if (type) {
            ref.setType(type);
        }
        return ref;
    }
}
exports.IRInference = IRInference;
//# sourceMappingURL=IRInference.js.map