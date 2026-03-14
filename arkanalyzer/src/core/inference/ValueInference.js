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
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
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
var InstanceInvokeExprInference_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.LocalInference = exports.ArkCastExprInference = exports.ArkInstanceOfExprInference = exports.ArkConditionExprInference = exports.ArkNormalBinOpExprInference = exports.ArkNewArrayExprInference = exports.ArkNewExprInference = exports.ArkPtrInvokeExprInference = exports.StaticInvokeExprInference = exports.InstanceInvokeExprInference = exports.StaticFieldRefInference = exports.FieldRefInference = exports.ClosureFieldRefInference = exports.ParameterRefInference = exports.ValueInference = exports.valueCtors = exports.InferLanguage = void 0;
exports.Bind = Bind;
const Type_1 = require("../base/Type");
const TypeInference_1 = require("../common/TypeInference");
const IRInference_1 = require("../common/IRInference");
const ArkMethod_1 = require("../model/ArkMethod");
const ValueUtil_1 = require("../common/ValueUtil");
const Const_1 = require("../common/Const");
const TSConst_1 = require("../common/TSConst");
const Expr_1 = require("../base/Expr");
const ModelUtils_1 = require("../common/ModelUtils");
const Local_1 = require("../base/Local");
const ArkClass_1 = require("../model/ArkClass");
const Constant_1 = require("../base/Constant");
const logger_1 = __importStar(require("../../utils/logger"));
const ArkSignature_1 = require("../model/ArkSignature");
const Builtin_1 = require("../common/Builtin");
const logger = logger_1.default.getLogger(logger_1.LOG_MODULE_TYPE.ARKANALYZER, 'ValueInference');
var InferLanguage;
(function (InferLanguage) {
    InferLanguage[InferLanguage["UNKNOWN"] = -1] = "UNKNOWN";
    InferLanguage[InferLanguage["COMMON"] = 0] = "COMMON";
    InferLanguage[InferLanguage["ARK_TS1_1"] = 1] = "ARK_TS1_1";
    InferLanguage[InferLanguage["ARK_TS1_2"] = 2] = "ARK_TS1_2";
    InferLanguage[InferLanguage["JAVA_SCRIPT"] = 3] = "JAVA_SCRIPT";
    InferLanguage[InferLanguage["CXX"] = 21] = "CXX";
    InferLanguage[InferLanguage["ABC"] = 51] = "ABC";
})(InferLanguage || (exports.InferLanguage = InferLanguage = {}));
exports.valueCtors = new Map();
function Bind(lang = InferLanguage.COMMON) {
    return (constructor) => {
        exports.valueCtors.set(constructor, lang);
        logger.info('the ValueInference %s registered.', constructor.name);
        return constructor;
    };
}
/**
 * Abstract base class for value-specific inference operations
 * @template T - Type parameter that must extend the Value base class
 */
class ValueInference {
    /**
     * Main inference workflow implementation
     * Orchestrates the preInfer → infer → postInfer sequence
     * @param value - The value to perform inference on
     * @param stmt - The statement where the value is located
     */
    doInfer(value, stmt) {
        try {
            // Only proceed if pre-inference checks pass
            if (this.preInfer(value, stmt)) {
                // Perform the core inference operation
                const newValue = this.infer(value, stmt);
                // Handle post-inference updates
                this.postInfer(value, newValue, stmt);
            }
        }
        catch (error) {
            logger.warn('infer value failed:' + error.message + ' from' + stmt?.toString());
        }
    }
    /**
     * Handles updates after inference completes
     * Replaces values in statements if new values are inferred
     * @param value - The original value that was inferred
     * @param newValue - The new inferred value
     * @param stmt - The statement where the value is located
     */
    postInfer(value, newValue, stmt) {
        if (newValue && stmt) {
            if (stmt.getDef() === value) {
                stmt.replaceDef(value, newValue);
            }
            else {
                stmt.replaceUse(value, newValue);
            }
        }
    }
}
exports.ValueInference = ValueInference;
/**
 * Parameter reference inference implementation for ArkParameterRef values
 * Handles type inference and resolution for parameter references in the IR
 */
let ParameterRefInference = class ParameterRefInference extends ValueInference {
    getValueName() {
        return 'ArkParameterRef';
    }
    /**
     * Determines if pre-inference should be performed on the given parameter reference
     * Checks if the parameter type requires inference (lexical environment types or unclear types)
     * @param {ArkParameterRef} value - The parameter reference to evaluate
     * @returns {boolean} True if pre-inference should be performed, false otherwise
     */
    preInfer(value) {
        const type = value.getType();
        return type instanceof Type_1.LexicalEnvType || TypeInference_1.TypeInference.isUnclearType(type);
    }
    /**
     * Performs inference on a parameter reference within the context of a statement
     * Resolves the parameter reference using the method's declaration context
     * @param {ArkParameterRef} value - The parameter reference to infer
     * @param {Stmt} stmt - The statement containing the parameter reference
     * @returns {Value | undefined} Always returns undefined as parameter references are resolved in-place
     */
    infer(value, stmt) {
        IRInference_1.IRInference.inferParameterRef(value, stmt.getCfg().getDeclaringMethod());
        return undefined;
    }
};
exports.ParameterRefInference = ParameterRefInference;
exports.ParameterRefInference = ParameterRefInference = __decorate([
    Bind()
], ParameterRefInference);
/**
 * Closure field reference inference implementation for ClosureFieldRef values
 * Handles type inference and resolution for closure field references in the IR
 */
let ClosureFieldRefInference = class ClosureFieldRefInference extends ValueInference {
    getValueName() {
        return 'ClosureFieldRef';
    }
    /**
     * Determines if pre-inference should be performed on the given closure field reference
     * Checks if the closure field type requires inference (unclear types)
     * @param {ClosureFieldRef} value - The closure field reference to evaluate
     * @returns {boolean} True if pre-inference should be performed, false otherwise
     */
    preInfer(value) {
        const type = value.getType();
        return TypeInference_1.TypeInference.isUnclearType(type);
    }
    /**
     * Performs inference on a closure field reference
     * Resolves the closure field type by looking up the field in the lexical environment's closures
     * @param {ClosureFieldRef} value - The closure field reference to infer
     * @returns {Value | undefined} Always returns undefined as closure field references are resolved in-place
     */
    infer(value) {
        const type = value.getBase().getType();
        if (type instanceof Type_1.LexicalEnvType) {
            let newType = type.getClosures().find(c => c.getName() === value.getFieldName())?.getType();
            if (newType && !TypeInference_1.TypeInference.isUnclearType(newType)) {
                value.setType(newType);
            }
        }
        return undefined;
    }
};
exports.ClosureFieldRefInference = ClosureFieldRefInference;
exports.ClosureFieldRefInference = ClosureFieldRefInference = __decorate([
    Bind()
], ClosureFieldRefInference);
let FieldRefInference = class FieldRefInference extends ValueInference {
    getValueName() {
        return 'ArkInstanceFieldRef';
    }
    /**
     * Determines if pre-inference should be performed on the given field reference
     * Checks if the field requires inference based on declaring signature, type clarity, or static status
     * @param {ArkInstanceFieldRef} value - The field reference to evaluate
     * @param {Stmt} [stmt] - Optional statement context for the evaluation
     * @returns {boolean} True if pre-inference should be performed, false otherwise
     */
    preInfer(value, stmt) {
        return IRInference_1.IRInference.needInfer(value.getFieldSignature().getDeclaringSignature().getDeclaringFileSignature()) ||
            TypeInference_1.TypeInference.isUnclearType(value.getType()) || value.getFieldSignature().isStatic();
    }
    /**
     * Performs inference on a field reference within the context of a statement
     * Handles special cases for array types and dynamic field access, and generates updated field signatures
     * @param {ArkInstanceFieldRef} value - The field reference to infer
     * @param {Stmt} stmt - The statement containing the field reference
     * @returns {Value | undefined} Returns a new ArkArrayRef for array types, ArkStaticFieldRef for static fields,
     *          or undefined for regular instance fields
     */
    infer(value, stmt) {
        const baseType = value.getBase().getType();
        const arkMethod = stmt.getCfg().getDeclaringMethod();
        // Generate updated field signature based on current context
        const result = IRInference_1.IRInference.inferInstanceMember(baseType, value, arkMethod, IRInference_1.IRInference.updateRefSignature);
        return !result || result === value ? undefined : result;
    }
};
exports.FieldRefInference = FieldRefInference;
exports.FieldRefInference = FieldRefInference = __decorate([
    Bind()
], FieldRefInference);
let StaticFieldRefInference = class StaticFieldRefInference extends ValueInference {
    getValueName() {
        return 'ArkStaticFieldRef';
    }
    /**
     * Determines if pre-inference should be performed on the given static field reference
     * Checks if the field requires inference based on declaring signature or type clarity
     * @param {ArkStaticFieldRef} value - The static field reference to evaluate
     * @param {Stmt} [stmt] - Optional statement context for the evaluation
     * @returns {boolean} True if pre-inference should be performed, false otherwise
     */
    preInfer(value, stmt) {
        return IRInference_1.IRInference.needInfer(value.getFieldSignature().getDeclaringSignature().getDeclaringFileSignature()) ||
            TypeInference_1.TypeInference.isUnclearType(value.getType());
    }
    /**
     * Performs inference on a static field reference within the context of a statement
     * Resolves the base type and generates updated field signatures, maintaining static field semantics
     * @param {ArkStaticFieldRef} value - The static field reference to infer
     * @param {Stmt} stmt - The statement containing the static field reference
     * @returns {Value | undefined} Returns a new ArkStaticFieldRef with updated signature, or undefined if no changes
     */
    infer(value, stmt) {
        const baseSignature = value.getFieldSignature().getDeclaringSignature();
        const baseName = baseSignature instanceof ArkSignature_1.ClassSignature ? baseSignature.getClassName() : baseSignature.getNamespaceName();
        const arkMethod = stmt.getCfg().getDeclaringMethod();
        const baseType = TypeInference_1.TypeInference.inferBaseType(baseName, arkMethod.getDeclaringArkClass());
        if (!baseType) {
            return undefined;
        }
        const result = IRInference_1.IRInference.inferInstanceMember(baseType, value, arkMethod, IRInference_1.IRInference.updateRefSignature);
        return !result || result === value ? undefined : result;
    }
};
exports.StaticFieldRefInference = StaticFieldRefInference;
exports.StaticFieldRefInference = StaticFieldRefInference = __decorate([
    Bind()
], StaticFieldRefInference);
let InstanceInvokeExprInference = InstanceInvokeExprInference_1 = class InstanceInvokeExprInference extends ValueInference {
    getValueName() {
        return 'ArkInstanceInvokeExpr';
    }
    /**
     * Determines if pre-inference should be performed on the given invocation expression
     * Checks if the method requires inference based on declaring signature or type clarity
     * @param {ArkInstanceInvokeExpr} value - The invocation expression to evaluate
     * @param {Stmt} [stmt] - Optional statement context for the evaluation
     * @returns {boolean} True if pre-inference should be performed, false otherwise
     */
    preInfer(value, stmt) {
        return IRInference_1.IRInference.needInfer(value.getMethodSignature().getDeclaringClassSignature().getDeclaringFileSignature()) ||
            TypeInference_1.TypeInference.isUnclearType(value.getType());
    }
    /**
     * Performs inference on an instance invocation expression within the context of a statement
     * Resolves the base type and method signature, handling various base type scenarios
     * @param {ArkInstanceInvokeExpr} value - The invocation expression to infer
     * @param {Stmt} stmt - The statement containing the invocation
     * @returns {Value | undefined} Returns a new invocation expression if transformed, undefined otherwise
     */
    infer(value, stmt) {
        const arkMethod = stmt.getCfg().getDeclaringMethod();
        const result = IRInference_1.IRInference.inferInstanceMember(value.getBase().getType(), value, arkMethod, InstanceInvokeExprInference_1.inferInvokeExpr);
        return !result || result === value ? undefined : result;
    }
    /**
     * Performs post-inference processing on invocation expressions
     * Handles special case for super() calls by replacing the base with 'this' local
     * @param {ArkInstanceInvokeExpr} value - The original invocation expression
     * @param {Value} newValue - The new value after inference
     * @param {Stmt} stmt - The statement containing the invocation
     */
    postInfer(value, newValue, stmt) {
        if (value instanceof Expr_1.ArkInstanceInvokeExpr && value.getBase().getName() === TSConst_1.SUPER_NAME) {
            const thisLocal = stmt.getCfg().getDeclaringMethod().getBody()?.getLocals().get(TSConst_1.THIS_NAME);
            if (thisLocal) {
                value.setBase(thisLocal);
                thisLocal.addUsedStmt(stmt);
            }
        }
        super.postInfer(value, newValue, stmt);
    }
    getMethodName(expr, arkMethod) {
        return expr.getMethodSignature().getMethodSubSignature().getMethodName();
    }
    static inferInvokeExpr(baseType, expr, arkMethod) {
        const methodName = expr.getMethodSignature().getMethodSubSignature().getMethodName();
        const scene = arkMethod.getDeclaringArkFile().getScene();
        if (baseType instanceof Type_1.ArrayType || baseType instanceof Type_1.TupleType) {
            const arrayInterface = scene.getSdkGlobal(Builtin_1.Builtin.ARRAY);
            const realTypes = baseType instanceof Type_1.ArrayType ? [baseType.getBaseType()] : undefined;
            if (arrayInterface instanceof ArkClass_1.ArkClass) {
                baseType = new Type_1.ClassType(arrayInterface.getSignature(), realTypes);
            }
            else if (methodName === Builtin_1.Builtin.ITERATOR_FUNCTION) {
                expr.getMethodSignature().getMethodSubSignature().setReturnType(Builtin_1.Builtin.ITERATOR_CLASS_TYPE);
                expr.setRealGenericTypes(realTypes ?? expr.getRealGenericTypes());
                return expr;
            }
        }
        // Dispatch to appropriate inference method based on resolved base type
        if (baseType instanceof Type_1.ClassType) {
            return IRInference_1.IRInference.inferInvokeExprWithDeclaredClass(expr, baseType, methodName, scene);
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
            return IRInference_1.IRInference.inferInvokeExprWithFunction(methodName, expr, baseType, scene);
        }
        return null;
    }
};
exports.InstanceInvokeExprInference = InstanceInvokeExprInference;
exports.InstanceInvokeExprInference = InstanceInvokeExprInference = InstanceInvokeExprInference_1 = __decorate([
    Bind()
], InstanceInvokeExprInference);
let StaticInvokeExprInference = class StaticInvokeExprInference extends InstanceInvokeExprInference {
    getValueName() {
        return 'ArkStaticInvokeExpr';
    }
    preInfer(value, stmt) {
        return IRInference_1.IRInference.needInfer(value.getMethodSignature().getDeclaringClassSignature().getDeclaringFileSignature());
    }
    infer(expr, stmt) {
        const arkMethod = stmt.getCfg().getDeclaringMethod();
        const methodName = this.getMethodName(expr, arkMethod);
        // special case process
        if (methodName === TSConst_1.IMPORT) {
            const arg = expr.getArg(0);
            let type;
            if (arg instanceof Constant_1.Constant) {
                type = TypeInference_1.TypeInference.inferDynamicImportType(arg.getValue(), arkMethod.getDeclaringArkClass());
            }
            if (type) {
                expr.getMethodSignature().getMethodSubSignature().setReturnType(type);
            }
            return undefined;
        }
        else if (methodName === TSConst_1.SUPER_NAME) {
            const superCtor = arkMethod.getDeclaringArkClass().getSuperClass()?.getMethodWithName(TSConst_1.CONSTRUCTOR_NAME);
            if (superCtor) {
                expr.setMethodSignature(superCtor.getSignature());
            }
            return undefined;
        }
        const baseType = this.getBaseType(expr, arkMethod);
        const result = baseType ? IRInference_1.IRInference.inferInstanceMember(baseType, expr, arkMethod, InstanceInvokeExprInference.inferInvokeExpr) :
            IRInference_1.IRInference.inferStaticInvokeExprByMethodName(methodName, arkMethod, expr);
        return !result || result === expr ? undefined : result;
    }
    getBaseType(expr, arkMethod) {
        const className = expr.getMethodSignature().getDeclaringClassSignature().getClassName();
        if (className && className !== Const_1.UNKNOWN_CLASS_NAME) {
            return TypeInference_1.TypeInference.inferBaseType(className, arkMethod.getDeclaringArkClass());
        }
        return null;
    }
};
exports.StaticInvokeExprInference = StaticInvokeExprInference;
exports.StaticInvokeExprInference = StaticInvokeExprInference = __decorate([
    Bind()
], StaticInvokeExprInference);
let ArkPtrInvokeExprInference = class ArkPtrInvokeExprInference extends StaticInvokeExprInference {
    getValueName() {
        return 'ArkPtrInvokeExpr';
    }
    infer(expr, stmt) {
        let ptrType = expr.getFuncPtrLocal().getType();
        if (ptrType instanceof Type_1.UnionType) {
            const funType = ptrType.getTypes().find(t => t instanceof Type_1.FunctionType);
            if (funType instanceof Type_1.FunctionType) {
                ptrType = funType;
            }
            else {
                ptrType = ptrType.getTypes().find(t => t instanceof Type_1.ClassType);
            }
        }
        let methodSignature;
        if (ptrType instanceof Type_1.FunctionType) {
            methodSignature = ptrType.getMethodSignature();
        }
        else if (ptrType instanceof Type_1.ClassType) {
            const methodName = ptrType.getClassSignature().getClassName() === TSConst_1.FUNCTION ? TSConst_1.CALL : Const_1.CALL_SIGNATURE_NAME;
            const scene = stmt.getCfg().getDeclaringMethod().getDeclaringArkFile().getScene();
            const callback = scene.getClass(ptrType.getClassSignature())?.getMethodWithName(methodName);
            if (callback) {
                methodSignature = callback.getSignature();
            }
        }
        if (methodSignature) {
            expr.setMethodSignature(methodSignature);
        }
        super.infer(expr, stmt);
        return undefined;
    }
};
exports.ArkPtrInvokeExprInference = ArkPtrInvokeExprInference;
exports.ArkPtrInvokeExprInference = ArkPtrInvokeExprInference = __decorate([
    Bind()
], ArkPtrInvokeExprInference);
let ArkNewExprInference = class ArkNewExprInference extends ValueInference {
    getValueName() {
        return 'ArkNewExpr';
    }
    preInfer(value) {
        return IRInference_1.IRInference.needInfer(value.getClassType().getClassSignature().getDeclaringFileSignature());
    }
    infer(value, stmt) {
        const className = value.getClassType().getClassSignature().getClassName();
        const arkMethod = stmt.getCfg().getDeclaringMethod();
        let type = ModelUtils_1.ModelUtils.findDeclaredLocal(new Local_1.Local(className), arkMethod, 1)?.getType();
        if (TypeInference_1.TypeInference.isUnclearType(type)) {
            type = TypeInference_1.TypeInference.inferUnclearRefName(className, arkMethod.getDeclaringArkClass());
        }
        if (type instanceof Type_1.AliasType) {
            const originType = TypeInference_1.TypeInference.replaceAliasType(type);
            if (originType instanceof Type_1.FunctionType) {
                type = originType.getMethodSignature().getMethodSubSignature().getReturnType();
            }
            else {
                type = originType;
            }
        }
        if (type && type instanceof Type_1.ClassType) {
            value.getClassType().setClassSignature(type.getClassSignature());
            TypeInference_1.TypeInference.inferRealGenericTypes(value.getClassType().getRealGenericTypes(), arkMethod.getDeclaringArkClass());
        }
        return undefined;
    }
};
exports.ArkNewExprInference = ArkNewExprInference;
exports.ArkNewExprInference = ArkNewExprInference = __decorate([
    Bind()
], ArkNewExprInference);
let ArkNewArrayExprInference = class ArkNewArrayExprInference extends ValueInference {
    getValueName() {
        return 'ArkNewArrayExpr';
    }
    preInfer(value) {
        return TypeInference_1.TypeInference.isUnclearType(value.getBaseType());
    }
    infer(value, stmt) {
        const type = TypeInference_1.TypeInference.inferUnclearedType(value.getBaseType(), stmt.getCfg().getDeclaringMethod().getDeclaringArkClass());
        if (type) {
            value.setBaseType(type);
        }
        return undefined;
    }
};
exports.ArkNewArrayExprInference = ArkNewArrayExprInference;
exports.ArkNewArrayExprInference = ArkNewArrayExprInference = __decorate([
    Bind()
], ArkNewArrayExprInference);
let ArkNormalBinOpExprInference = class ArkNormalBinOpExprInference extends ValueInference {
    getValueName() {
        return 'ArkNormalBinopExpr';
    }
    preInfer(value) {
        return TypeInference_1.TypeInference.isUnclearType(value.getType());
    }
    infer(value) {
        value.setType();
        return undefined;
    }
};
exports.ArkNormalBinOpExprInference = ArkNormalBinOpExprInference;
exports.ArkNormalBinOpExprInference = ArkNormalBinOpExprInference = __decorate([
    Bind()
], ArkNormalBinOpExprInference);
let ArkConditionExprInference = class ArkConditionExprInference extends ArkNormalBinOpExprInference {
    getValueName() {
        return 'ArkConditionExpr';
    }
    preInfer(value) {
        return true;
    }
    infer(value) {
        if (value.getOperator() === Expr_1.RelationalBinaryOperator.InEquality && value.getOp2() === ValueUtil_1.ValueUtil.getOrCreateNumberConst(0)) {
            const op1Type = value.getOp1().getType();
            if (op1Type instanceof Type_1.StringType) {
                value.setOp2(ValueUtil_1.ValueUtil.createStringConst(ValueUtil_1.EMPTY_STRING));
            }
            else if (op1Type instanceof Type_1.BooleanType) {
                value.setOp2(ValueUtil_1.ValueUtil.getBooleanConstant(false));
            }
            else if (op1Type instanceof Type_1.ClassType) {
                value.setOp2(ValueUtil_1.ValueUtil.getUndefinedConst());
            }
        }
        value.fillType();
        return undefined;
    }
};
exports.ArkConditionExprInference = ArkConditionExprInference;
exports.ArkConditionExprInference = ArkConditionExprInference = __decorate([
    Bind()
], ArkConditionExprInference);
let ArkInstanceOfExprInference = class ArkInstanceOfExprInference extends ValueInference {
    getValueName() {
        return 'ArkInstanceOfExpr';
    }
    preInfer(value) {
        return TypeInference_1.TypeInference.isUnclearType(value.getCheckType());
    }
    infer(value, stmt) {
        const type = TypeInference_1.TypeInference.inferUnclearedType(value.getCheckType(), stmt.getCfg().getDeclaringMethod().getDeclaringArkClass());
        if (type) {
            value.setCheckType(type);
        }
        return undefined;
    }
};
exports.ArkInstanceOfExprInference = ArkInstanceOfExprInference;
exports.ArkInstanceOfExprInference = ArkInstanceOfExprInference = __decorate([
    Bind()
], ArkInstanceOfExprInference);
let ArkCastExprInference = class ArkCastExprInference extends ValueInference {
    getValueName() {
        return 'ArkCastExpr';
    }
    preInfer(value) {
        return TypeInference_1.TypeInference.isUnclearType(value.getType());
    }
    infer(value, stmt) {
        const arkClass = stmt.getCfg().getDeclaringMethod().getDeclaringArkClass();
        const type = TypeInference_1.TypeInference.inferUnclearedType(value.getType(), arkClass);
        if (type && !TypeInference_1.TypeInference.isUnclearType(type)) {
            IRInference_1.IRInference.inferRightWithSdkType(type, value.getOp().getType(), arkClass);
            value.setType(type);
        }
        else if (!TypeInference_1.TypeInference.isUnclearType(value.getOp().getType())) {
            value.setType(value.getOp().getType());
        }
        return undefined;
    }
};
exports.ArkCastExprInference = ArkCastExprInference;
exports.ArkCastExprInference = ArkCastExprInference = __decorate([
    Bind()
], ArkCastExprInference);
let LocalInference = class LocalInference extends ValueInference {
    getValueName() {
        return 'Local';
    }
    preInfer(value) {
        return TypeInference_1.TypeInference.isUnclearType(value.getType());
    }
    infer(value, stmt) {
        const name = value.getName();
        const arkClass = stmt.getCfg().getDeclaringMethod().getDeclaringArkClass();
        // Special handling for 'this' reference - set to current class type
        if (name === TSConst_1.THIS_NAME) {
            value.setType(new Type_1.ClassType(arkClass.getSignature(), arkClass.getRealTypes()));
            return undefined;
        }
        let newType;
        // Skip temporary variables (those with name prefix) and look for declared locals
        if (!name.startsWith(Const_1.NAME_PREFIX)) {
            newType = ModelUtils_1.ModelUtils.findDeclaredLocal(value, stmt.getCfg().getDeclaringMethod(), 1)?.getType() ??
                TypeInference_1.TypeInference.inferBaseType(name, arkClass);
        }
        if (newType) {
            value.setType(newType);
        }
        return undefined;
    }
};
exports.LocalInference = LocalInference;
exports.LocalInference = LocalInference = __decorate([
    Bind()
], LocalInference);
//# sourceMappingURL=ValueInference.js.map