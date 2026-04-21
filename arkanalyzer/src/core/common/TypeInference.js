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
exports.TypeInference = void 0;
const logger_1 = __importStar(require("../../utils/logger"));
const Expr_1 = require("../base/Expr");
const Local_1 = require("../base/Local");
const Ref_1 = require("../base/Ref");
const Stmt_1 = require("../base/Stmt");
const Type_1 = require("../base/Type");
const ArkMethod_1 = require("../model/ArkMethod");
const ArkClass_1 = require("../model/ArkClass");
const ArkField_1 = require("../model/ArkField");
const Constant_1 = require("../base/Constant");
const ArkNamespace_1 = require("../model/ArkNamespace");
const TSConst_1 = require("./TSConst");
const ModelUtils_1 = require("./ModelUtils");
const Builtin_1 = require("./Builtin");
const ArkSignature_1 = require("../model/ArkSignature");
const Const_1 = require("./Const");
const ValueUtil_1 = require("./ValueUtil");
const ArkImport_1 = require("../model/ArkImport");
const IRInference_1 = require("./IRInference");
const TypeExpr_1 = require("../base/TypeExpr");
const SdkUtils_1 = require("./SdkUtils");
const ArkBaseModel_1 = require("../model/ArkBaseModel");
const logger = logger_1.default.getLogger(logger_1.LOG_MODULE_TYPE.ARKANALYZER, 'TypeInference');
const unknownFileName = [Const_1.UNKNOWN_FILE_NAME, Builtin_1.Builtin.DUMMY_FILE_NAME];
class TypeInference {
    static inferTypeInArkField(arkField) {
        const arkClass = arkField.getDeclaringArkClass();
        const stmts = arkField.getInitializer();
        const method = arkClass.getMethodWithName(Const_1.INSTANCE_INIT_METHOD_NAME) ??
            arkClass.getMethodWithName(Const_1.STATIC_INIT_METHOD_NAME) ??
            arkClass.getMethodWithName(TSConst_1.CONSTRUCTOR_NAME);
        for (const stmt of stmts) {
            if (method) {
                this.resolveStmt(stmt, method);
            }
        }
        const beforeType = arkField.getType();
        if (!this.isUnclearType(beforeType)) {
            return;
        }
        let rightType;
        let fieldRef;
        const lastStmt = stmts[stmts.length - 1];
        if (lastStmt instanceof Stmt_1.ArkAssignStmt) {
            rightType = lastStmt.getRightOp().getType();
            if (lastStmt.getLeftOp() instanceof Ref_1.ArkInstanceFieldRef) {
                fieldRef = lastStmt.getLeftOp();
            }
        }
        let fieldType;
        if (beforeType) {
            fieldType = this.inferUnclearedType(beforeType, arkClass);
        }
        if (fieldType) {
            arkField.getSignature().setType(fieldType);
            fieldRef?.setFieldSignature(arkField.getSignature());
        }
        else if (rightType && this.isUnclearType(beforeType) && !this.isUnclearType(rightType)) {
            arkField.getSignature().setType(rightType);
            fieldRef?.setFieldSignature(arkField.getSignature());
        }
    }
    /**
     * Infer type for a given unclear type.
     * It returns an array with 2 items, original object and original type.
     * The original object is null if there is no object, or it failed to find the object.
     * The original type is null if failed to infer the type.
     * @param leftOpType
     * @param declaringArkClass
     * @param visited
     * @returns
     */
    static inferUnclearedType(leftOpType, declaringArkClass, visited = new Set()) {
        if (visited.has(leftOpType)) {
            return leftOpType;
        }
        else {
            visited.add(leftOpType);
        }
        let type;
        if (leftOpType instanceof Type_1.ClassType && unknownFileName.includes(leftOpType.getClassSignature().getDeclaringFileSignature().getFileName())) {
            const realTypes = leftOpType.getRealGenericTypes();
            this.inferRealGenericTypes(realTypes, declaringArkClass);
            let newType = TypeInference.inferUnclearRefName(leftOpType.getClassSignature().getClassName(), declaringArkClass);
            type = newType ? this.replaceTypeWithReal(newType, realTypes) : null;
        }
        else if (leftOpType instanceof TypeExpr_1.TypeQueryExpr) {
            this.inferRealGenericTypes(leftOpType.getGenerateTypes(), declaringArkClass);
            type = leftOpType;
        }
        else if (leftOpType instanceof Type_1.TupleType) {
            this.inferRealGenericTypes(leftOpType.getTypes(), declaringArkClass);
            type = leftOpType;
        }
        else if (leftOpType instanceof Type_1.GenericType) {
            this.inferGenericType([leftOpType], declaringArkClass);
            type = leftOpType;
        }
        else if (leftOpType instanceof Type_1.AnnotationNamespaceType) {
            type = this.inferBaseType(leftOpType.getOriginType(), declaringArkClass);
        }
        else if (leftOpType instanceof Type_1.UnclearReferenceType) {
            type = this.inferUnclearRefType(leftOpType, declaringArkClass);
        }
        if (type) {
            return type;
        }
        return TypeInference.inferUnclearComplexType(leftOpType, declaringArkClass, visited);
    }
    static inferUnclearComplexType(leftOpType, declaringArkClass, visited) {
        let type;
        if (leftOpType instanceof Type_1.UnionType || leftOpType instanceof Type_1.IntersectionType || leftOpType instanceof Type_1.TupleType) {
            let types = leftOpType.getTypes();
            for (let i = 0; i < types.length; i++) {
                let newType = this.inferUnclearedType(types[i], declaringArkClass, visited);
                if (newType) {
                    types[i] = newType;
                }
            }
            type = leftOpType;
        }
        else if (leftOpType instanceof Type_1.ArrayType) {
            let baseType = this.inferUnclearedType(leftOpType.getBaseType(), declaringArkClass, visited);
            if (baseType) {
                leftOpType.setBaseType(baseType);
                type = leftOpType;
            }
        }
        else if (leftOpType instanceof Type_1.AliasType) {
            const defArkClass = declaringArkClass.getDeclaringArkFile().getScene().getMethod(leftOpType.getSignature().getDeclaringMethodSignature())?.getDeclaringArkClass();
            let baseType = this.inferUnclearedType(leftOpType.getOriginalType(), defArkClass ?? declaringArkClass, visited);
            if (baseType) {
                leftOpType.setOriginalType(baseType);
                type = leftOpType;
            }
        }
        else if (leftOpType instanceof TypeExpr_1.KeyofTypeExpr) {
            let baseType = this.inferUnclearedType(leftOpType.getOpType(), declaringArkClass, visited);
            if (baseType) {
                leftOpType.setOpType(baseType);
                type = leftOpType;
            }
        }
        return type;
    }
    static inferTypeInMethod(arkMethod) {
        const arkClass = arkMethod.getDeclaringArkClass();
        this.inferGenericType(arkMethod.getGenericTypes(), arkClass);
        const signatures = [];
        arkMethod.getDeclareSignatures()?.forEach(m => signatures.push(m));
        const impl = arkMethod.getImplementationSignature();
        if (impl) {
            signatures.push(impl);
        }
        signatures.forEach(s => {
            s.getMethodSubSignature()
                .getParameters()
                .forEach(p => {
                this.inferParameterType(p, arkMethod);
            });
        });
        const body = arkMethod.getBody();
        if (!body) {
            signatures.forEach(s => this.inferSignatureReturnType(s, arkMethod));
            return;
        }
        body.getUsedGlobals()?.forEach((value, key) => {
            if (value instanceof Ref_1.GlobalRef && !value.getRef()) {
                const arkExport = ModelUtils_1.ModelUtils.findGlobalRef(key, arkMethod);
                if (arkExport instanceof Local_1.Local) {
                    arkExport.getUsedStmts().push(...value.getUsedStmts());
                    value.setRef(arkExport);
                }
            }
        });
        const cfg = body.getCfg();
        for (const block of cfg.getBlocks()) {
            for (const stmt of block.getStmts()) {
                this.resolveStmt(stmt, arkMethod);
            }
        }
        signatures.forEach(s => this.inferSignatureReturnType(s, arkMethod));
    }
    static resolveStmt(stmt, arkMethod) {
        try {
            this.resolveTypeExprsInStmt(stmt, arkMethod);
            this.resolveExprsInStmt(stmt, arkMethod);
            this.resolveFieldRefsInStmt(stmt, arkMethod);
            this.resolveArkAssignStmt(stmt, arkMethod);
            this.resolveArkReturnStmt(stmt, arkMethod);
        }
        catch (e) {
            logger.warn('stmt is not correct: ' + stmt.toString());
        }
    }
    /**
     * @Deprecated
     * @param arkMethod
     */
    static inferSimpleTypeInMethod(arkMethod) {
        const body = arkMethod.getBody();
        if (!body) {
            logger.warn('empty body');
            return;
        }
        const cfg = body.getCfg();
        if (!cfg) {
            logger.warn('empty cfg');
            return;
        }
        for (const block of cfg.getBlocks()) {
            for (const stmt of block.getStmts()) {
                TypeInference.inferSimpleTypeInStmt(stmt);
            }
        }
    }
    /**
     * infer type for Exprs in stmt which invoke method.
     * such as ArkInstanceInvokeExpr ArkStaticInvokeExpr ArkNewExpr
     */
    static resolveExprsInStmt(stmt, arkMethod) {
        for (const expr of stmt.getExprs()) {
            const newExpr = expr.inferType(arkMethod);
            if (stmt.containsInvokeExpr() &&
                ((expr instanceof Expr_1.ArkInstanceInvokeExpr && newExpr instanceof Expr_1.ArkStaticInvokeExpr) || newExpr instanceof Expr_1.ArkPtrInvokeExpr)) {
                stmt.replaceUse(expr, newExpr);
            }
            // After infer the invoke method, it should replace the super.foo() to this.foo() while the foo is with super class as declaring class.
            if (newExpr instanceof Expr_1.ArkInstanceInvokeExpr && newExpr.getBase().getName() === TSConst_1.SUPER_NAME) {
                const thisLocal = arkMethod.getBody()?.getLocals().get(TSConst_1.THIS_NAME);
                if (thisLocal) {
                    newExpr.setBase(thisLocal);
                    thisLocal.addUsedStmt(stmt);
                }
            }
        }
        if (stmt instanceof Stmt_1.ArkAliasTypeDefineStmt && this.isUnclearType(stmt.getAliasType().getOriginalType())) {
            stmt.getAliasType().setOriginalType(stmt.getAliasTypeExpr().getType());
        }
    }
    /**
     * infer value type for TypeExprs in stmt which specify the type such as TypeQueryExpr
     */
    static resolveTypeExprsInStmt(stmt, arkMethod) {
        for (let typeExpr of stmt.getTypeExprs()) {
            typeExpr.inferType(arkMethod);
        }
    }
    /**
     * infer type for fieldRefs in stmt.
     */
    static resolveFieldRefsInStmt(stmt, arkMethod) {
        for (const use of stmt.getUses()) {
            if (use instanceof Ref_1.AbstractRef) {
                this.processRef(use, stmt, arkMethod);
            }
        }
        const stmtDef = stmt.getDef();
        if (stmtDef && stmtDef instanceof Ref_1.AbstractRef) {
            if (arkMethod.getName() === Const_1.INSTANCE_INIT_METHOD_NAME &&
                stmtDef instanceof Ref_1.ArkInstanceFieldRef &&
                stmtDef.getBase().getName() === TSConst_1.THIS_NAME &&
                arkMethod.getDeclaringArkClass().isAnonymousClass() &&
                stmtDef.getFieldName().indexOf('.') === -1) {
                return;
            }
            this.processRef(stmtDef, stmt, arkMethod, false);
        }
    }
    static processRef(use, stmt, arkMethod, replaceUse = true) {
        const fieldRef = use.inferType(arkMethod);
        if (fieldRef instanceof Ref_1.ArkStaticFieldRef && stmt instanceof Stmt_1.ArkAssignStmt) {
            if (replaceUse) {
                stmt.replaceUse(use, fieldRef);
            }
            else {
                stmt.replaceDef(use, fieldRef);
            }
        }
        else if (use instanceof Ref_1.ArkInstanceFieldRef && fieldRef instanceof Ref_1.ArkArrayRef && stmt instanceof Stmt_1.ArkAssignStmt) {
            const index = fieldRef.getIndex();
            if (index instanceof Constant_1.Constant && index.getType() instanceof Type_1.StringType) {
                const local = this.getLocalFromMethodBody(index.getValue(), arkMethod);
                if (local) {
                    fieldRef.setIndex(local);
                }
            }
            if (replaceUse) {
                stmt.replaceUse(use, fieldRef);
            }
            else {
                stmt.replaceDef(use, fieldRef);
            }
        }
    }
    static getLocalFromMethodBody(name, arkMethod) {
        const local = arkMethod?.getBody()?.getLocals().get(name);
        if (local) {
            return local;
        }
        const globalRef = arkMethod?.getBody()?.getUsedGlobals()?.get(name);
        if (globalRef === undefined || !(globalRef instanceof Ref_1.GlobalRef)) {
            return null;
        }
        const ref = globalRef.getRef();
        if (ref !== null && ref instanceof Local_1.Local) {
            return ref;
        }
        return null;
    }
    static parseArkExport2Type(arkExport) {
        if (!arkExport) {
            return null;
        }
        if (arkExport instanceof ArkClass_1.ArkClass) {
            return new Type_1.ClassType(arkExport.getSignature(), arkExport.getGenericsTypes());
        }
        else if (arkExport instanceof ArkNamespace_1.ArkNamespace) {
            return Type_1.AnnotationNamespaceType.getInstance(arkExport.getSignature());
        }
        else if (arkExport instanceof ArkMethod_1.ArkMethod) {
            return new Type_1.FunctionType(arkExport.getSignature(), arkExport.getGenericTypes());
        }
        else if (arkExport instanceof Local_1.Local) {
            if (arkExport.getType() instanceof Type_1.UnknownType || arkExport.getType() instanceof Type_1.UnclearReferenceType) {
                return null;
            }
            return arkExport.getType();
        }
        else if (arkExport instanceof Type_1.AliasType) {
            return arkExport;
        }
        else {
            return null;
        }
    }
    /**
     * infer and pass type for ArkAssignStmt right and left
     * @param stmt
     * @param arkMethod
     */
    static resolveArkAssignStmt(stmt, arkMethod) {
        if (!(stmt instanceof Stmt_1.ArkAssignStmt)) {
            return;
        }
        const arkClass = arkMethod.getDeclaringArkClass();
        const rightOp = stmt.getRightOp();
        if (rightOp instanceof Local_1.Local && rightOp.getType() instanceof Type_1.UnknownType) {
            IRInference_1.IRInference.inferLocal(rightOp, arkMethod);
        }
        let rightType = rightOp.getType();
        if (this.isUnclearType(rightType)) {
            rightType = this.inferUnclearedType(rightType, arkClass);
            if (rightType) {
                this.setValueType(rightOp, rightType);
            }
        }
        TypeInference.resolveLeftOp(stmt, arkClass, rightType, arkMethod);
    }
    static resolveLeftOp(stmt, arkClass, rightType, arkMethod) {
        let leftType = this.inferLeftOpType(stmt, arkClass, rightType, arkMethod);
        const leftOp = stmt.getLeftOp();
        if (leftType && !this.isUnclearType(leftType)) {
            this.setValueType(leftOp, leftType);
            if (leftOp instanceof Local_1.Local && stmt.getOriginalText()?.startsWith(leftOp.getName())) {
                let localDef = ModelUtils_1.ModelUtils.findDeclaredLocal(leftOp, arkMethod);
                if (localDef && this.isUnclearType(localDef.getType())) {
                    localDef.setType(leftType);
                }
            }
            if (rightType) {
                IRInference_1.IRInference.inferRightWithSdkType(leftType, rightType, arkClass);
            }
            if (leftOp instanceof Ref_1.AbstractFieldRef) {
                const declaringSignature = leftOp.getFieldSignature().getDeclaringSignature();
                if (declaringSignature instanceof ArkSignature_1.NamespaceSignature && declaringSignature.getNamespaceName() === TSConst_1.GLOBAL_THIS_NAME) {
                    SdkUtils_1.SdkUtils.computeGlobalThis(leftOp, arkMethod);
                }
            }
        }
    }
    static inferLeftOpType(stmt, arkClass, rightType, arkMethod) {
        const leftOp = stmt.getLeftOp();
        let leftType = leftOp.getType();
        if (this.isUnclearType(leftType)) {
            const newLeftType = this.inferUnclearedType(leftType, arkClass);
            if (!newLeftType && !this.isUnclearType(rightType)) {
                leftType = rightType;
            }
            else if (newLeftType) {
                leftType = newLeftType;
            }
        }
        else if (leftOp instanceof Local_1.Local && leftOp.getName() === TSConst_1.THIS_NAME) {
            const thisLocal = IRInference_1.IRInference.inferThisLocal(arkMethod);
            if (thisLocal) {
                stmt.setLeftOp(thisLocal);
            }
            else {
                leftType = rightType;
            }
        }
        else if (leftType instanceof Type_1.FunctionType && !this.isUnclearType(rightType) &&
            leftType.getMethodSignature().getMethodSubSignature().getMethodName().startsWith(Const_1.ANONYMOUS_METHOD_PREFIX)) {
            leftType = rightType;
        }
        return leftType || null;
    }
    static setValueType(value, type) {
        if (value instanceof Local_1.Local || value instanceof Ref_1.ArkParameterRef) {
            value.setType(type);
        }
        else if (value instanceof Ref_1.AbstractFieldRef) {
            value.getFieldSignature().setType(type);
        }
    }
    static isUnclearType(type) {
        // TODO: For UnionType, IntersectionType and TupleType, it should recurse check every item of them.
        if (!type || type instanceof Type_1.UnknownType || type instanceof Type_1.UnclearReferenceType || type instanceof Type_1.NullType ||
            type instanceof Type_1.UndefinedType || type instanceof Type_1.GenericType) {
            return true;
        }
        else if (type instanceof Type_1.ClassType &&
            (unknownFileName.includes(type.getClassSignature().getDeclaringFileSignature().getFileName()) ||
                (type.getClassSignature().getClassName() === TSConst_1.PROMISE && !type.getRealGenericTypes()))) {
            return true;
        }
        else if (type instanceof Type_1.UnionType || type instanceof Type_1.IntersectionType || type instanceof Type_1.TupleType) {
            return !!type.getTypes().find(t => this.checkType(t, e => e instanceof Type_1.UnclearReferenceType || e instanceof Type_1.GenericType));
        }
        else if (type instanceof Type_1.ArrayType) {
            const baseType = type.getBaseType();
            return this.checkType(baseType, t => t instanceof Type_1.UnclearReferenceType || baseType instanceof Type_1.GenericType);
        }
        else if (type instanceof Type_1.AliasType) {
            return this.isUnclearType(type.getOriginalType());
        }
        else if (type instanceof TypeExpr_1.KeyofTypeExpr) {
            return this.isUnclearType(type.getOpType());
        }
        else if (type instanceof TypeExpr_1.TypeQueryExpr) {
            return this.isUnclearType(type.getType()) ||
                !!type.getGenerateTypes()?.find(t => this.checkType(t, e => e instanceof Type_1.UnclearReferenceType || e instanceof Type_1.GenericType));
        }
        return false;
    }
    // This is the temporal function to check Type recursively and can be removed after typeInfer supports multiple candidate types.
    static checkType(type, check, visited = new Set()) {
        if (visited.has(type)) {
            return false;
        }
        else {
            visited.add(type);
        }
        if (check(type)) {
            return true;
        }
        else if (type instanceof Type_1.ClassType || type instanceof Type_1.FunctionType) {
            return !!type.getRealGenericTypes()?.find(t => this.checkType(t, check, visited));
        }
        else if (type instanceof Type_1.UnionType || type instanceof Type_1.IntersectionType || type instanceof Type_1.TupleType) {
            return !!type.getTypes().find(t => this.checkType(t, check, visited));
        }
        else if (type instanceof Type_1.ArrayType) {
            return this.checkType(type.getBaseType(), check, visited);
        }
        else if (type instanceof Type_1.AliasType) {
            return this.checkType(type.getOriginalType(), check, visited);
        }
        else if (type instanceof TypeExpr_1.KeyofTypeExpr) {
            return this.checkType(type.getOpType(), check, visited);
        }
        else if (type instanceof TypeExpr_1.TypeQueryExpr) {
            return this.checkType(type.getType(), check, visited);
        }
        return false;
    }
    static inferSimpleTypeInStmt(stmt) {
        if (stmt instanceof Stmt_1.ArkAssignStmt) {
            const leftOp = stmt.getLeftOp();
            if (leftOp instanceof Local_1.Local) {
                const leftOpType = leftOp.getType();
                if (leftOpType instanceof Type_1.UnknownType) {
                    const rightOp = stmt.getRightOp();
                    leftOp.setType(rightOp.getType());
                }
            }
        }
    }
    // Deal only with simple situations
    static buildTypeFromStr(typeStr) {
        switch (typeStr) {
            case TSConst_1.BOOLEAN_KEYWORD:
                return Type_1.BooleanType.getInstance();
            case TSConst_1.NUMBER_KEYWORD:
                return Type_1.NumberType.getInstance();
            case TSConst_1.STRING_KEYWORD:
                return Type_1.StringType.getInstance();
            case TSConst_1.UNDEFINED_KEYWORD:
                return Type_1.UndefinedType.getInstance();
            case TSConst_1.NULL_KEYWORD:
                return Type_1.NullType.getInstance();
            case TSConst_1.ANY_KEYWORD:
                return Type_1.AnyType.getInstance();
            case TSConst_1.VOID_KEYWORD:
                return Type_1.VoidType.getInstance();
            case TSConst_1.NEVER_KEYWORD:
                return Type_1.NeverType.getInstance();
            case TSConst_1.BIGINT_KEYWORD:
                return Type_1.BigIntType.getInstance();
            case 'RegularExpression': {
                const classSignature = Builtin_1.Builtin.REGEXP_CLASS_SIGNATURE;
                return new Type_1.ClassType(classSignature);
            }
            default:
                return new Type_1.UnclearReferenceType(typeStr);
        }
    }
    static inferValueType(value, arkMethod) {
        if (value instanceof Ref_1.ArkInstanceFieldRef || value instanceof Expr_1.ArkInstanceInvokeExpr) {
            this.inferValueType(value.getBase(), arkMethod);
        }
        if (value instanceof Ref_1.AbstractRef || value instanceof Expr_1.AbstractExpr || value instanceof Local_1.Local) {
            value.inferType(arkMethod);
        }
        return value.getType();
    }
    static inferParameterType(param, arkMethod) {
        let pType = param.getType();
        const arkClass = arkMethod.getDeclaringArkClass();
        let type;
        if (pType instanceof TypeExpr_1.AbstractTypeExpr) {
            pType.inferType(arkMethod);
        }
        else if (param.getName() === 'value' && arkClass.hasComponentDecorator() && arkMethod.getName() === TSConst_1.CONSTRUCTOR_NAME) {
            type = this.parseArkExport2Type(arkClass);
        }
        else {
            type = TypeInference.inferUnclearedType(pType, arkClass);
        }
        if (type) {
            param.setType(type);
        }
    }
    static inferSignatureReturnType(oldSignature, arkMethod) {
        if (oldSignature.getMethodSubSignature().getMethodName() === TSConst_1.CONSTRUCTOR_NAME) {
            const newReturnType = new Type_1.ClassType(oldSignature.getDeclaringClassSignature());
            oldSignature.getMethodSubSignature().setReturnType(newReturnType);
            return;
        }
        const currReturnType = oldSignature.getType();
        if (!this.isUnclearType(currReturnType)) {
            return;
        }
        if (currReturnType instanceof TypeExpr_1.AbstractTypeExpr) {
            currReturnType.inferType(arkMethod);
            return;
        }
        if (currReturnType instanceof Type_1.ArrayType && currReturnType.getBaseType() instanceof TypeExpr_1.AbstractTypeExpr) {
            currReturnType.getBaseType().inferType(arkMethod);
            return;
        }
        const newReturnType = this.inferUnclearedType(currReturnType, arkMethod.getDeclaringArkClass());
        if (newReturnType) {
            oldSignature.getMethodSubSignature().setReturnType(newReturnType);
        }
    }
    static inferReturnType(arkMethod) {
        const typeMap = new Map();
        for (let returnValue of arkMethod.getReturnValues()) {
            const type = returnValue.getType();
            if (type instanceof Type_1.UnionType) {
                type.flatType()
                    .filter(t => !TypeInference.isUnclearType(t))
                    .forEach(t => typeMap.set(t.toString(), t));
            }
            else if (!TypeInference.isUnclearType(type)) {
                typeMap.set(type.toString(), type);
            }
        }
        if (typeMap.size > 0) {
            const types = Array.from(typeMap.values());
            let returnType = types.length === 1 ? types[0] : new Type_1.UnionType(types);
            if (arkMethod.containsModifier(ArkBaseModel_1.ModifierType.ASYNC)) {
                const promise = arkMethod.getDeclaringArkFile().getScene().getSdkGlobal(TSConst_1.PROMISE);
                if (promise instanceof ArkClass_1.ArkClass) {
                    returnType = new Type_1.ClassType(promise.getSignature(), [returnType]);
                }
            }
            return returnType;
        }
        return null;
    }
    static inferGenericType(types, arkClass) {
        types?.forEach(type => {
            const defaultType = type.getDefaultType();
            if (defaultType && this.isUnclearType(defaultType)) {
                const newDefaultType = TypeInference.inferUnclearedType(defaultType, arkClass);
                if (newDefaultType) {
                    type.setDefaultType(this.replaceTypeWithReal(newDefaultType));
                }
            }
            const constraint = type.getConstraint();
            if (constraint && this.isUnclearType(constraint)) {
                const newConstraint = TypeInference.inferUnclearedType(constraint, arkClass);
                if (newConstraint) {
                    type.setConstraint(this.replaceTypeWithReal(newConstraint));
                }
            }
        });
    }
    /**
     * Infer type for a given {@link UnclearReferenceType} type.
     * It returns original type.
     * The original type is null if it failed to infer the type.
     * @param urType
     * @param arkClass
     * @returns
     */
    static inferUnclearRefType(urType, arkClass) {
        const realTypes = urType.getGenericTypes();
        this.inferRealGenericTypes(realTypes, arkClass);
        if (urType.getName() === Builtin_1.Builtin.ARRAY && realTypes.length > 0) {
            return new Type_1.ArrayType(realTypes[0], 1);
        }
        const type = this.inferUnclearRefName(urType.getName(), arkClass);
        return type ? this.replaceTypeWithReal(type, realTypes) : null;
    }
    /**
     * Find out the original object and type for a given unclear reference type name.
     * It returns original type.
     * The original type is null if it failed to infer the type.
     * @param refName
     * @param arkClass
     * @returns
     */
    static inferUnclearRefName(refName, arkClass) {
        if (!refName) {
            return null;
        }
        //split and iterate to infer each type
        const singleNames = refName.split('.');
        let type = null;
        for (let i = 0; i < singleNames.length; i++) {
            let genericName = ValueUtil_1.EMPTY_STRING;
            const name = singleNames[i].replace(/<(.+)>/, (match, group1) => {
                genericName = group1;
                return ValueUtil_1.EMPTY_STRING;
            });
            if (i === 0) {
                type = singleNames.length > 1 ? this.inferBaseType(name, arkClass) : this.inferTypeByName(name, arkClass);
            }
            else if (type) {
                type = this.inferFieldType(type, name, arkClass)?.[1];
            }
            if (!type) {
                return null;
            }
            if (genericName) {
                const realTypes = genericName.split(',').map(generic => {
                    const realType = this.inferUnclearRefName(generic, arkClass);
                    return realType ?? new Type_1.UnclearReferenceType(generic);
                });
                if (type instanceof Type_1.ClassType) {
                    type = new Type_1.ClassType(type.getClassSignature(), realTypes);
                }
                else if (type instanceof Type_1.FunctionType) {
                    type = new Type_1.FunctionType(type.getMethodSignature(), realTypes);
                }
            }
        }
        return type;
    }
    /**
     * Find out the original object and type for a given base type and the field name.
     * It returns an array with 2 items, original object and original type.
     * The original object is null if there is no object, or it failed to find the object.
     * The original type is null if it failed to infer the type.
     * @param baseType
     * @param fieldName
     * @param declareClass
     * @returns
     */
    static inferFieldType(baseType, fieldName, declareClass) {
        if (baseType instanceof Type_1.AliasType) {
            baseType = baseType.getOriginalType();
        }
        else if (baseType instanceof Type_1.UnionType && baseType.getCurrType()) {
            baseType = baseType.getCurrType();
        }
        let propertyAndType = null;
        if (baseType instanceof Type_1.ClassType) {
            if (fieldName === Builtin_1.Builtin.ITERATOR_RESULT_VALUE &&
                baseType.getClassSignature().getDeclaringFileSignature().getProjectName() === Builtin_1.Builtin.DUMMY_PROJECT_NAME) {
                const types = baseType.getRealGenericTypes();
                if (types && types.length > 0) {
                    return [null, types[0]];
                }
                return null;
            }
            propertyAndType = this.inferClassFieldType(declareClass, baseType, fieldName);
        }
        else if (baseType instanceof Type_1.ArrayType) {
            propertyAndType = this.inferArrayFieldType(declareClass, fieldName);
        }
        else if (baseType instanceof Type_1.AnnotationNamespaceType) {
            const namespace = declareClass.getDeclaringArkFile().getScene().getNamespace(baseType.getNamespaceSignature());
            if (namespace) {
                const property = ModelUtils_1.ModelUtils.findPropertyInNamespace(fieldName, namespace);
                const propertyType = this.parseArkExport2Type(property);
                if (propertyType) {
                    propertyAndType = [property, propertyType];
                }
            }
        }
        else {
            logger.warn('infer unclear reference type fail: ' + fieldName);
        }
        return propertyAndType;
    }
    static inferClassFieldType(declareClass, baseType, fieldName) {
        const arkClass = declareClass.getDeclaringArkFile().getScene().getClass(baseType.getClassSignature());
        if (!arkClass) {
            return null;
        }
        const property = ModelUtils_1.ModelUtils.findPropertyInClass(fieldName, arkClass);
        let propertyType = null;
        if (property instanceof ArkField_1.ArkField) {
            if (arkClass.getCategory() === ArkClass_1.ClassCategory.ENUM) {
                propertyType = this.getEnumValueType(property);
            }
            else {
                this.repairFieldType(property, arkClass);
                propertyType = this.replaceTypeWithReal(property.getType(), baseType.getRealGenericTypes());
            }
        }
        else if (property) {
            propertyType = this.parseArkExport2Type(property);
        }
        if (propertyType) {
            return [property, propertyType];
        }
        else if (arkClass.isAnonymousClass()) {
            const fieldType = this.inferUnclearRefName(fieldName, arkClass);
            return fieldType ? [null, fieldType] : null;
        }
        return null;
    }
    static repairFieldType(property, arkClass) {
        const propertyType = property.getType();
        if (TypeInference.isUnclearType(propertyType)) {
            const newType = TypeInference.inferUnclearedType(propertyType, arkClass);
            if (newType) {
                property.getSignature().setType(newType);
            }
        }
    }
    static getEnumValueType(property) {
        if (property.getCategory() !== ArkField_1.FieldCategory.ENUM_MEMBER) {
            return null;
        }
        const type = property.getType();
        if (type instanceof Type_1.EnumValueType) {
            return type;
        }
        const initStmts = property.getInitializer();
        const lastStmt = initStmts[initStmts.length - 1];
        let constant;
        if (lastStmt instanceof Stmt_1.ArkAssignStmt) {
            const rightOp = lastStmt.getRightOp();
            constant = rightOp instanceof Constant_1.Constant ? rightOp : new Constant_1.Constant('unknown', rightOp.getType());
        }
        const enumValueType = new Type_1.EnumValueType(property.getSignature(), constant);
        property.getSignature().setType(enumValueType);
        return enumValueType;
    }
    static inferArrayFieldType(declareClass, fieldName) {
        const arrayClass = declareClass.getDeclaringArkFile().getScene().getSdkGlobal(Builtin_1.Builtin.ARRAY);
        if (arrayClass instanceof ArkClass_1.ArkClass) {
            const property = ModelUtils_1.ModelUtils.findPropertyInClass(fieldName, arrayClass);
            if (property instanceof ArkField_1.ArkField) {
                return [property, property.getType()];
            }
            return null;
        }
        return null;
    }
    /**
     * Find out the original object and type for a given base name.
     * It returns original type.
     * The original type is null if failed to infer the type.
     * @param baseName
     * @param arkClass
     * @returns
     */
    static inferBaseType(baseName, arkClass) {
        if (TSConst_1.SUPER_NAME === baseName) {
            return this.parseArkExport2Type(arkClass.getSuperClass());
        }
        else if (TSConst_1.DEFAULT === baseName) {
            return this.parseArkExport2Type(arkClass.getDeclaringArkFile().getExportInfoBy(TSConst_1.DEFAULT)?.getArkExport());
        }
        let arkExport = ModelUtils_1.ModelUtils.findSymbolInFileWithName(baseName, arkClass) ??
            ModelUtils_1.ModelUtils.getArkExportInImportInfoWithName(baseName, arkClass.getDeclaringArkFile());
        if (!arkExport && !arkClass.getDeclaringArkFile().getImportInfoBy(baseName)) {
            arkExport = arkClass.getDeclaringArkFile().getScene().getSdkGlobal(baseName);
        }
        return this.parseArkExport2Type(arkExport);
    }
    static inferTypeByName(typeName, arkClass) {
        //look up from declared file, if not found then from imports
        const declaredArkFile = arkClass.getDeclaringArkFile();
        let arkExport = ModelUtils_1.ModelUtils.findSymbolInFileWithName(typeName, arkClass, true) ??
            ModelUtils_1.ModelUtils.getArkExportInImportInfoWithName(typeName, declaredArkFile);
        //if not found or local in built-in then look up global in sdks
        if ((!arkExport || (arkExport instanceof Local_1.Local && declaredArkFile.getProjectName() === SdkUtils_1.SdkUtils.BUILT_IN_NAME)) &&
            !declaredArkFile.getImportInfoBy(typeName)) {
            const globalVal = arkClass.getDeclaringArkFile().getScene().getSdkGlobal(typeName);
            if (globalVal) {
                arkExport = globalVal;
            }
        }
        const type = this.parseArkExport2Type(arkExport);
        if (type instanceof Type_1.ClassType || type instanceof Type_1.AliasType) {
            return type;
        }
        return arkClass.getGenericsTypes()?.find(g => g.getName() === typeName) || null;
    }
    static getTypeByGlobalName(globalName, arkMethod) {
        const arkExport = arkMethod.getDeclaringArkFile().getScene().getSdkGlobal(globalName);
        return this.parseArkExport2Type(arkExport);
    }
    static inferRealGenericTypes(realTypes, arkClass) {
        if (!realTypes) {
            return;
        }
        for (let i = 0; i < realTypes.length; i++) {
            const mayType = realTypes[i];
            if (this.isUnclearType(mayType)) {
                const newType = this.inferUnclearedType(mayType, arkClass);
                if (newType) {
                    realTypes[i] = newType;
                }
            }
        }
    }
    static inferDynamicImportType(from, arkClass) {
        const importInfo = new ArkImport_1.ImportInfo();
        importInfo.setNameBeforeAs(TSConst_1.ALL);
        importInfo.setImportClauseName(TSConst_1.ALL);
        importInfo.setImportFrom(from);
        importInfo.setDeclaringArkFile(arkClass.getDeclaringArkFile());
        return TypeInference.parseArkExport2Type(importInfo.getLazyExportInfo()?.getArkExport());
    }
    static replaceTypeWithReal(type, realTypes, visited = new Set()) {
        if (visited.has(type)) {
            return type;
        }
        else {
            visited.add(type);
        }
        if (type instanceof Type_1.GenericType) {
            const realType = realTypes?.[type.getIndex()] ?? type.getDefaultType() ?? type.getConstraint();
            return realType ?? type;
        }
        else if (type instanceof Type_1.AnyType) {
            const realType = realTypes?.[0];
            return realType ?? type;
        }
        return this.replaceRecursiveType(type, visited, realTypes);
    }
    static replaceRecursiveType(type, visited, realTypes) {
        if (type instanceof Type_1.ClassType) {
            const replacedTypes = type.getRealGenericTypes()?.map(g => this.replaceTypeWithReal(g, realTypes, visited)) ?? realTypes;
            return replacedTypes && replacedTypes.length > 0 ? new Type_1.ClassType(type.getClassSignature(), replacedTypes) : type;
        }
        else if (type instanceof Type_1.FunctionType) {
            const replacedTypes = type.getRealGenericTypes()?.map(g => this.replaceTypeWithReal(g, realTypes, visited)) ?? realTypes;
            return replacedTypes && replacedTypes.length > 0 ? new Type_1.FunctionType(type.getMethodSignature(), replacedTypes) : type;
        }
        else if (type instanceof Type_1.AliasType && realTypes) {
            const newObjectType = this.replaceTypeWithReal(type.getOriginalType(), realTypes, visited);
            const replacedTypes = type.getRealGenericTypes()?.map(g => this.replaceTypeWithReal(g, realTypes, visited)) ?? realTypes;
            if (replacedTypes.length > 0) {
                const newAliasType = new Type_1.AliasType(type.getName(), newObjectType, type.getSignature(), type.getGenericTypes());
                newAliasType.setRealGenericTypes(replacedTypes);
                return newAliasType;
            }
        }
        else if (type instanceof Type_1.UnionType && realTypes) {
            const types = [];
            type.flatType().forEach(t => types.push(this.replaceTypeWithReal(t, realTypes, visited)));
            return new Type_1.UnionType(types, this.replaceTypeWithReal(type.getCurrType(), realTypes, visited));
        }
        else if (type instanceof Type_1.IntersectionType && realTypes) {
            const types = [];
            type.getTypes().forEach(t => types.push(this.replaceTypeWithReal(t, realTypes, visited)));
            return new Type_1.IntersectionType(types);
        }
        else if (type instanceof Type_1.ArrayType && realTypes) {
            const replacedBaseType = this.replaceTypeWithReal(type.getBaseType(), realTypes, visited);
            return new Type_1.ArrayType(replacedBaseType, type.getDimension());
        }
        else if (type instanceof Type_1.TupleType && realTypes) {
            let replacedTypes = [];
            type.getTypes().forEach(t => replacedTypes.push(this.replaceTypeWithReal(t, realTypes, visited)));
            return new Type_1.TupleType(replacedTypes);
        }
        return type;
    }
    static replaceAliasType(type) {
        let aliasType = type;
        while (aliasType instanceof Type_1.AliasType) {
            aliasType = aliasType.getOriginalType();
        }
        return aliasType;
    }
    static inferFunctionType(argType, paramSubSignature, realTypes) {
        const returnType = argType.getMethodSignature().getMethodSubSignature().getReturnType();
        const declareType = paramSubSignature?.getReturnType();
        if (this.isUnclearType(returnType) && declareType && !this.isUnclearType(declareType)) {
            argType.getMethodSignature().getMethodSubSignature().setReturnType(declareType);
        }
        const params = paramSubSignature?.getParameters();
        if (!params) {
            return;
        }
        argType
            .getMethodSignature()
            .getMethodSubSignature()
            .getParameters()
            .filter(p => !p.getName().startsWith(Const_1.LEXICAL_ENV_NAME_PREFIX))
            .forEach((p, i) => {
            if (this.isUnclearType(p.getType())) {
                let type = params?.[i]?.getType();
                if (type instanceof Type_1.GenericType && realTypes) {
                    type = realTypes?.[type.getIndex()];
                }
                if (type) {
                    p.setType(type);
                }
            }
        });
    }
    static resolveArkReturnStmt(stmt, arkMethod) {
        if (!(stmt instanceof Stmt_1.ArkReturnStmt)) {
            return;
        }
        this.inferValueType(stmt.getOp(), arkMethod);
        let returnType = arkMethod.getSignature().getType();
        if (returnType instanceof Type_1.ClassType && returnType.getClassSignature().getClassName() === TSConst_1.PROMISE) {
            returnType = returnType.getRealGenericTypes()?.[0];
        }
        if (returnType) {
            IRInference_1.IRInference.inferRightWithSdkType(returnType, stmt.getOp().getType(), arkMethod.getDeclaringArkClass());
        }
    }
    static isAnonType(argType, projectName) {
        const isAnonClassType = argType instanceof Type_1.ClassType &&
            argType.getClassSignature().getClassName().startsWith(Const_1.ANONYMOUS_CLASS_PREFIX) &&
            argType.getClassSignature().getDeclaringFileSignature().getProjectName() === projectName;
        if (isAnonClassType) {
            return true;
        }
        return argType instanceof Type_1.FunctionType &&
            argType.getMethodSignature().getMethodSubSignature().getMethodName().startsWith(Const_1.ANONYMOUS_METHOD_PREFIX) &&
            argType.getMethodSignature().getDeclaringClassSignature().getDeclaringFileSignature().getProjectName() === projectName;
    }
    static isDummyClassType(rightType) {
        return rightType instanceof Type_1.ClassType &&
            rightType.getClassSignature().getDeclaringFileSignature().getFileName() === Builtin_1.Builtin.DUMMY_FILE_NAME &&
            !!rightType.getRealGenericTypes()?.find(t => !(t instanceof Type_1.GenericType));
    }
    static isTypeCanBeOverride(type) {
        if (type instanceof Type_1.UnknownType || type instanceof Type_1.NullType || type instanceof Type_1.UndefinedType ||
            type instanceof Type_1.UnclearReferenceType || type instanceof Type_1.GenericType) {
            return true;
        }
        else if (type instanceof Type_1.ClassType) {
            return !!type.getRealGenericTypes()?.find(r => this.isTypeCanBeOverride(r));
        }
        else if (type instanceof Type_1.AliasType) {
            return this.isTypeCanBeOverride(type.getOriginalType()) || !!type.getRealGenericTypes()?.find(r => this.isTypeCanBeOverride(r));
        }
        else if (type instanceof Type_1.ArrayType) {
            return TypeInference.checkType(type.getBaseType(), t => t instanceof Type_1.UnclearReferenceType || t instanceof Type_1.GenericType);
        }
        return false;
    }
    static union(type1, type2) {
        const leftType = TypeInference.replaceAliasType(type1);
        const rightType = TypeInference.replaceAliasType(type2);
        if (this.isSameType(leftType, rightType) || TypeInference.checkType(rightType, t => t instanceof Type_1.AnyType ||
            (rightType instanceof Type_1.ClassType && rightType.getClassSignature().getClassName().startsWith(Const_1.ANONYMOUS_CLASS_PREFIX)))) {
            return type1;
        }
        else if (leftType instanceof Type_1.FunctionType) {
            return type1;
        }
        else if (leftType instanceof Type_1.UnionType) {
            const isExist = leftType.getTypes().find(t => this.isSameType(t, rightType));
            if (!isExist) {
                leftType.getTypes().push(type2);
            }
            return type1;
        }
        else if (leftType instanceof Type_1.IntersectionType) {
            const isExist = leftType.getTypes().find(t => !this.isSameType(t, rightType));
            if (!isExist) {
                return type1;
            }
        }
        return new Type_1.UnionType([type1, type2]);
    }
    static isSameType(type1, type2) {
        if (type1 instanceof Type_1.ClassType && type2 instanceof Type_1.ClassType) {
            return type1.getClassSignature() === type2.getClassSignature();
        }
        else if (type1 instanceof Type_1.LiteralType) {
            return typeof type1.getLiteralName() === type2.toString();
        }
        else if (type1 instanceof TypeExpr_1.KeyofTypeExpr) {
            return type2 instanceof TypeExpr_1.KeyofTypeExpr || type2 instanceof Type_1.StringType;
        }
        else if (type1 instanceof Type_1.TupleType) {
            return type2 instanceof Type_1.TupleType || type2 instanceof Type_1.ArrayType;
        }
        return type1.constructor === type2.constructor;
    }
}
exports.TypeInference = TypeInference;
//# sourceMappingURL=TypeInference.js.map