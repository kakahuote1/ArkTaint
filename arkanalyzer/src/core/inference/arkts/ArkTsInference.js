"use strict";
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
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ArkTSLocalInference = exports.AliasTypeExprInference = exports.ArkTsInstanceInvokeExprInference = exports.ArkTSFieldRefInference = exports.JsInferenceBuilder = exports.ArkTs2InferenceBuilder = exports.ArkTsInferenceBuilder = exports.ArkTsStmtInference = void 0;
const ModelInference_1 = require("../ModelInference");
const ArkImport_1 = require("../../model/ArkImport");
const ModelUtils_1 = require("../../common/ModelUtils");
const ArkClass_1 = require("../../model/ArkClass");
const TypeInference_1 = require("../../common/TypeInference");
const InferenceBuilder_1 = require("../InferenceBuilder");
const ValueInference_1 = require("../ValueInference");
const Stmt_1 = require("../../base/Stmt");
const Type_1 = require("../../base/Type");
const Ref_1 = require("../../base/Ref");
const Local_1 = require("../../base/Local");
const AbcInference_1 = require("../abc/AbcInference");
const Const_1 = require("../../common/Const");
const TSConst_1 = require("../../common/TSConst");
const Expr_1 = require("../../base/Expr");
const IRInference_1 = require("../../common/IRInference");
const ArkField_1 = require("../../model/ArkField");
class ArkTsImportInference extends ModelInference_1.ImportInfoInference {
    /**
     * get arkFile and assign to from file
     * @param fromInfo
     */
    preInfer(fromInfo) {
        this.fromFile = (0, ModelUtils_1.getArkFile)(fromInfo) || null;
    }
}
class ArkTsClassInference extends ModelInference_1.ClassInference {
    preInfer(arkClass) {
        super.preInfer(arkClass);
        TypeInference_1.TypeInference.inferGenericType(arkClass.getGenericsTypes(), arkClass);
        arkClass.getFields()
            .filter(p => TypeInference_1.TypeInference.isUnclearType(p.getType()))
            .forEach(f => {
            const newType = TypeInference_1.TypeInference.inferUnclearedType(f.getType(), arkClass);
            if (newType) {
                f.getSignature().setType(newType);
            }
        });
    }
}
class ArkTsMethodInference extends ModelInference_1.MethodInference {
    preInfer(arkMethod) {
        TypeInference_1.TypeInference.inferGenericType(arkMethod.getGenericTypes(), arkMethod.getDeclaringArkClass());
        arkMethod.getDeclareSignatures()?.forEach(x => this.inferMethodSignature(x, arkMethod));
        const implSignature = arkMethod.getImplementationSignature();
        if (implSignature) {
            this.inferMethodSignature(implSignature, arkMethod);
        }
    }
    inferMethodSignature(ms, arkMethod) {
        ms.getMethodSubSignature().getParameters().forEach(p => TypeInference_1.TypeInference.inferParameterType(p, arkMethod));
        TypeInference_1.TypeInference.inferSignatureReturnType(ms, arkMethod);
    }
}
class ArkTsStmtInference extends ModelInference_1.StmtInference {
    constructor(valueInferences) {
        super(valueInferences);
    }
    typeSpread(stmt, method) {
        if (stmt instanceof Stmt_1.ArkAliasTypeDefineStmt && TypeInference_1.TypeInference.isUnclearType(stmt.getAliasType().getOriginalType())) {
            const originalType = stmt.getAliasTypeExpr().getOriginalType();
            if (originalType) {
                stmt.getAliasType().setOriginalType(originalType);
            }
        }
        return super.typeSpread(stmt, method);
    }
    transferRight2Left(leftOp, rightType, method) {
        const projectName = method.getDeclaringArkFile().getProjectName();
        if (!TypeInference_1.TypeInference.isUnclearType(rightType) || rightType instanceof Type_1.GenericType || TypeInference_1.TypeInference.isDummyClassType(rightType)) {
            let leftType = leftOp.getType();
            if (TypeInference_1.TypeInference.isTypeCanBeOverride(leftType) || TypeInference_1.TypeInference.isAnonType(leftType, projectName)) {
                leftType = rightType;
            }
            else {
                leftType = TypeInference_1.TypeInference.union(leftType, rightType);
            }
            if (leftOp.getType() !== leftType) {
                return ArkTsStmtInference.updateUnionType(leftOp, leftType, method);
            }
        }
        return undefined;
    }
    static updateUnionType(target, srcType, method) {
        if (target instanceof Local_1.Local) {
            target.setType(srcType);
            const globalRef = method.getBody()?.getUsedGlobals()?.get(target.getName());
            let result;
            if (globalRef instanceof Ref_1.GlobalRef) {
                result = this.updateGlobalRef(globalRef.getRef(), srcType);
            }
            return result ? result : target.getUsedStmts();
        }
        else if (target instanceof Ref_1.AbstractFieldRef) {
            target.getFieldSignature().setType(srcType);
        }
        else if (target instanceof Ref_1.ArkParameterRef) {
            target.setType(srcType);
        }
        return undefined;
    }
    static updateGlobalRef(ref, srcType) {
        if (ref instanceof Local_1.Local) {
            let leftType = ref.getType();
            if (TypeInference_1.TypeInference.isTypeCanBeOverride(leftType)) {
                leftType = srcType;
            }
            else {
                leftType = TypeInference_1.TypeInference.union(leftType, srcType);
            }
            if (ref.getType() !== leftType) {
                ref.setType(leftType);
                return ref.getUsedStmts();
            }
        }
        return undefined;
    }
}
exports.ArkTsStmtInference = ArkTsStmtInference;
class ArkTsInferenceBuilder extends InferenceBuilder_1.InferenceBuilder {
    buildImportInfoInference() {
        return new ArkTsImportInference();
    }
    buildClassInference() {
        return new ArkTsClassInference(this.buildMethodInference());
    }
    buildMethodInference() {
        return new ArkTsMethodInference(this.buildStmtInference());
    }
    buildStmtInference() {
        const valueInferences = this.getValueInferences(ValueInference_1.InferLanguage.COMMON);
        this.getValueInferences(ValueInference_1.InferLanguage.ARK_TS1_1).forEach(e => valueInferences.push(e));
        return new ArkTsStmtInference(valueInferences);
    }
}
exports.ArkTsInferenceBuilder = ArkTsInferenceBuilder;
class ArkTs2InferenceBuilder extends ArkTsInferenceBuilder {
}
exports.ArkTs2InferenceBuilder = ArkTs2InferenceBuilder;
class JsInferenceBuilder extends InferenceBuilder_1.InferenceBuilder {
    buildImportInfoInference() {
        return new ArkTsImportInference();
    }
    buildMethodInference() {
        return new AbcInference_1.AbcMethodInference(this.buildStmtInference());
    }
    buildStmtInference() {
        const valueInferences = this.getValueInferences(ValueInference_1.InferLanguage.COMMON);
        return new ArkTsStmtInference(valueInferences);
    }
}
exports.JsInferenceBuilder = JsInferenceBuilder;
let ArkTSFieldRefInference = class ArkTSFieldRefInference extends ValueInference_1.FieldRefInference {
    preInfer(value, stmt) {
        if (stmt.getDef() === value && this.isAnonClassThisRef(value, stmt.getCfg().getDeclaringMethod())) {
            return false;
        }
        return super.preInfer(value);
    }
    /**
     * Checks if a value represents an anonymous class 'this' field reference
     * Identifies field references that access fields directly on 'this' in anonymous class constructors
     * @param {Value} stmtDef - The value to check (typically a field reference)
     * @param {ArkMethod} arkMethod - The method containing the value
     * @returns {boolean} True if the value is an anonymous class 'this' field reference
     */
    isAnonClassThisRef(stmtDef, arkMethod) {
        return (arkMethod.getName() === Const_1.INSTANCE_INIT_METHOD_NAME || arkMethod.getName() === TSConst_1.CONSTRUCTOR_NAME) &&
            stmtDef instanceof Ref_1.ArkInstanceFieldRef &&
            stmtDef.getBase().getName() === TSConst_1.THIS_NAME &&
            arkMethod.getDeclaringArkClass().isAnonymousClass() &&
            stmtDef.getFieldName().indexOf('.') === -1;
    }
};
exports.ArkTSFieldRefInference = ArkTSFieldRefInference;
exports.ArkTSFieldRefInference = ArkTSFieldRefInference = __decorate([
    (0, ValueInference_1.Bind)(ValueInference_1.InferLanguage.ARK_TS1_1)
], ArkTSFieldRefInference);
let ArkTsInstanceInvokeExprInference = class ArkTsInstanceInvokeExprInference extends ValueInference_1.InstanceInvokeExprInference {
    /**
     * Performs inference on an instance invocation expression within the context of a statement
     * Enhances the base implementation with real generic type inference and extension function support
     * @param {ArkInstanceInvokeExpr} value - The invocation expression to infer
     * @param {Stmt} stmt - The statement containing the invocation
     * @returns {Value | undefined} Returns a new expression if transformed, undefined otherwise
     */
    infer(value, stmt) {
        const arkMethod = stmt.getCfg().getDeclaringMethod();
        TypeInference_1.TypeInference.inferRealGenericTypes(value.getRealGenericTypes(), arkMethod.getDeclaringArkClass());
        const result = IRInference_1.IRInference.inferInstanceMember(value.getBase().getType(), value, arkMethod, ValueInference_1.InstanceInvokeExprInference.inferInvokeExpr) ??
            this.processExtendFunc(value, arkMethod, super.getMethodName(value, arkMethod));
        return !result || result === value ? undefined : result;
    }
    /**
     * process arkUI function with Annotation @Extend @Styles @AnimatableExtend
     * @param expr
     * @param arkMethod
     * @param methodName
     */
    processExtendFunc(expr, arkMethod, methodName) {
        const annoMethod = arkMethod.getDeclaringArkClass().getMethodWithName(methodName) ??
            arkMethod.getDeclaringArkFile().getDefaultClass().getMethodWithName(methodName);
        if (annoMethod) {
            expr.setMethodSignature(annoMethod.getSignature());
            return expr;
        }
        return null;
    }
};
exports.ArkTsInstanceInvokeExprInference = ArkTsInstanceInvokeExprInference;
exports.ArkTsInstanceInvokeExprInference = ArkTsInstanceInvokeExprInference = __decorate([
    (0, ValueInference_1.Bind)(ValueInference_1.InferLanguage.ARK_TS1_1)
], ArkTsInstanceInvokeExprInference);
let AliasTypeExprInference = class AliasTypeExprInference extends ValueInference_1.ValueInference {
    getValueName() {
        return 'AliasTypeExpr';
    }
    preInfer(value) {
        return value.getOriginalType() === undefined;
    }
    infer(value, stmt) {
        let originalObject = value.getOriginalObject();
        const arkMethod = stmt.getCfg().getDeclaringMethod();
        let type;
        let originalLocal;
        if (originalObject instanceof Local_1.Local) {
            originalLocal = ModelUtils_1.ModelUtils.findArkModelByRefName(originalObject.getName(), arkMethod.getDeclaringArkClass());
            if (Expr_1.AliasTypeExpr.isAliasTypeOriginalModel(originalLocal)) {
                originalObject = originalLocal;
            }
        }
        if (originalObject instanceof ArkImport_1.ImportInfo) {
            const arkExport = originalObject.getLazyExportInfo()?.getArkExport();
            const importClauseName = originalObject.getImportClauseName();
            if (importClauseName.includes('.') && arkExport instanceof ArkClass_1.ArkClass) {
                type = TypeInference_1.TypeInference.inferUnclearRefName(importClauseName, arkExport);
            }
            else if (arkExport) {
                type = TypeInference_1.TypeInference.parseArkExport2Type(arkExport);
            }
        }
        else if (originalObject instanceof Type_1.Type) {
            type = TypeInference_1.TypeInference.inferUnclearedType(originalObject, arkMethod.getDeclaringArkClass());
        }
        else if (originalObject instanceof ArkField_1.ArkField) {
            type = originalObject.getType();
        }
        else {
            type = TypeInference_1.TypeInference.parseArkExport2Type(originalObject);
        }
        if (type) {
            const realGenericTypes = value.getRealGenericTypes();
            if (TypeInference_1.TypeInference.checkType(type, t => t instanceof Type_1.GenericType || t instanceof Type_1.AnyType) && realGenericTypes && realGenericTypes.length > 0) {
                TypeInference_1.TypeInference.inferRealGenericTypes(realGenericTypes, arkMethod.getDeclaringArkClass());
                type = TypeInference_1.TypeInference.replaceTypeWithReal(type, realGenericTypes);
            }
            value.setOriginalType(type);
            if (Expr_1.AliasTypeExpr.isAliasTypeOriginalModel(originalLocal)) {
                value.setOriginalObject(originalLocal);
            }
        }
        return undefined;
    }
};
exports.AliasTypeExprInference = AliasTypeExprInference;
exports.AliasTypeExprInference = AliasTypeExprInference = __decorate([
    (0, ValueInference_1.Bind)(ValueInference_1.InferLanguage.ARK_TS1_1)
], AliasTypeExprInference);
let ArkTSLocalInference = class ArkTSLocalInference extends ValueInference_1.LocalInference {
    getValueName() {
        return 'Local';
    }
    preInfer(value) {
        const type = value.getType();
        if (value.getName() === TSConst_1.THIS_NAME && type instanceof Type_1.ClassType &&
            type.getClassSignature().getClassName().startsWith(Const_1.ANONYMOUS_CLASS_PREFIX)) {
            return true;
        }
        else if (type instanceof Type_1.FunctionType) {
            return true;
        }
        return super.preInfer(value);
    }
    infer(value, stmt) {
        const name = value.getName();
        const type = value.getType();
        const arkMethod = stmt.getCfg().getDeclaringMethod();
        let newType;
        if (name === TSConst_1.THIS_NAME) {
            newType = IRInference_1.IRInference.inferThisLocal(arkMethod)?.getType();
            if (newType) {
                value.setType(newType);
            }
            return undefined;
        }
        else if (type instanceof Type_1.FunctionType) {
            const methodSignature = type.getMethodSignature();
            methodSignature.getMethodSubSignature().getParameters().forEach(p => TypeInference_1.TypeInference.inferParameterType(p, arkMethod));
            TypeInference_1.TypeInference.inferSignatureReturnType(methodSignature, arkMethod);
            return undefined;
        }
        else {
            newType = TypeInference_1.TypeInference.inferUnclearedType(type, arkMethod.getDeclaringArkClass()) ?? this.getEnumValue(arkMethod.getDeclaringArkClass(), name);
        }
        if (newType) {
            value.setType(newType);
            return undefined;
        }
        return super.infer(value, stmt);
    }
    getEnumValue(arkClass, name) {
        if (arkClass.getCategory() === ArkClass_1.ClassCategory.ENUM) {
            const field = arkClass.getStaticFieldWithName(name);
            if (field) {
                return TypeInference_1.TypeInference.getEnumValueType(field);
            }
        }
        return null;
    }
};
exports.ArkTSLocalInference = ArkTSLocalInference;
exports.ArkTSLocalInference = ArkTSLocalInference = __decorate([
    (0, ValueInference_1.Bind)(ValueInference_1.InferLanguage.ARK_TS1_1)
], ArkTSLocalInference);
//# sourceMappingURL=ArkTsInference.js.map