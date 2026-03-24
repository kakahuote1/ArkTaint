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
exports.SourceTransformer = void 0;
const Constant_1 = require("../../core/base/Constant");
const Expr_1 = require("../../core/base/Expr");
const Local_1 = require("../../core/base/Local");
const ArkClass_1 = require("../../core/model/ArkClass");
const ArkMethod_1 = require("../../core/model/ArkMethod");
const ArkSignature_1 = require("../../core/model/ArkSignature");
const logger_1 = __importStar(require("../../utils/logger"));
const PrinterUtils_1 = require("../base/PrinterUtils");
const SourceMethod_1 = require("./SourceMethod");
const Type_1 = require("../../core/base/Type");
const SourceClass_1 = require("./SourceClass");
const Ref_1 = require("../../core/base/Ref");
const EtsConst_1 = require("../../core/common/EtsConst");
const Const_1 = require("../../core/common/Const");
const Stmt_1 = require("../../core/base/Stmt");
const ArkNamespace_1 = require("../../core/model/ArkNamespace");
const TypeExpr_1 = require("../../core/base/TypeExpr");
const ArkBaseModel_1 = require("../../core/model/ArkBaseModel");
const ArkField_1 = require("../../core/model/ArkField");
const ArkExport_1 = require("../../core/model/ArkExport");
const ArkImport_1 = require("../../core/model/ArkImport");
const TSConst_1 = require("../../core/common/TSConst");
const logger = logger_1.default.getLogger(logger_1.LOG_MODULE_TYPE.ARKANALYZER, 'SourceTransformer');
class SourceTransformer {
    constructor(context) {
        this.context = context;
    }
    anonymousMethodToString(method, indent) {
        let mtdPrinter = new SourceMethod_1.SourceMethod(method, indent);
        mtdPrinter.setInBuilder(this.context.isInBuilderMethod());
        return mtdPrinter.dump().trimStart();
    }
    anonymousClassToString(cls, indent) {
        let clsPrinter = new SourceClass_1.SourceClass(cls, indent);
        return clsPrinter.dump().trimStart();
    }
    instanceInvokeExprToString(invokeExpr, isAttr) {
        let methodName = invokeExpr.getMethodSignature().getMethodSubSignature().getMethodName();
        if (methodName === Const_1.INSTANCE_INIT_METHOD_NAME) {
            return '';
        }
        let args = [];
        invokeExpr.getArgs().forEach(v => {
            args.push(this.valueToString(v));
        });
        let genericCode = isAttr ? '' : this.genericTypesToString(invokeExpr.getRealGenericTypes());
        if (isAttr && this.context.isInBuilderMethod()) {
            return `.${methodName}${genericCode}(${args.join(', ')})`;
        }
        const base = invokeExpr.getBase();
        if (base.getName() === TSConst_1.THIS_NAME) {
            if (methodName === TSConst_1.CONSTRUCTOR_NAME) {
                return `super(${args.join(', ')})`;
            }
            // If base type is not match the method declaring class, here take it as super.foo() even though the source code may be this.foo().
            // Because it can not distinguish exactly whether it's this.foo() or super.foo() when foo is only defined in super class.
            const baseType = base.getType();
            if (baseType instanceof Type_1.ClassType) {
                if (!(0, ArkSignature_1.classSignatureCompare)(baseType.getClassSignature(), invokeExpr.getMethodSignature().getDeclaringClassSignature())) {
                    return `super.${methodName}${genericCode}(${args.join(', ')})`;
                }
            }
        }
        return `${this.valueToString(base)}.${methodName}${genericCode}(${args.join(', ')})`;
    }
    transBuilderMethod(className, methodName, args, invokeExpr, genericCode) {
        if (className === EtsConst_1.COMPONENT_CUSTOMVIEW) {
            if (methodName === EtsConst_1.COMPONENT_CREATE_FUNCTION) {
                // Anonymous @Builder method
                if (args.length > 1) {
                    // remove the substring '() =>' or '(x, y): type =>' at the beginning of args[1]
                    const pattern = /^\([^)]*\)\s*:\s*\w*\s*=>\s*/;
                    args[1] = args[1].replace(pattern, '');
                }
                return `${args.join(' ')}`;
            }
            if (methodName === EtsConst_1.COMPONENT_POP_FUNCTION) {
                return '';
            }
        }
        if (PrinterUtils_1.PrinterUtils.isComponentCreate(invokeExpr)) {
            if (className === EtsConst_1.COMPONENT_IF) {
                return `if (${args.join(', ')})`;
            }
            return `${className}${genericCode}(${args.join(', ')})`;
        }
        if (PrinterUtils_1.PrinterUtils.isComponentIfBranchInvoke(invokeExpr)) {
            let arg0 = invokeExpr.getArg(0);
            if (arg0.getValue() === '0') {
                return ``;
            }
            else {
                return '} else {';
            }
        }
        if (PrinterUtils_1.PrinterUtils.isComponentPop(invokeExpr)) {
            return '}';
        }
        return null;
    }
    staticInvokeExprToString(invokeExpr) {
        let methodSignature = invokeExpr.getMethodSignature();
        let method = this.context.getMethod(methodSignature);
        if (method && PrinterUtils_1.PrinterUtils.isAnonymousMethod(method.getName())) {
            return this.anonymousMethodToString(method, this.context.getPrinter().getIndent());
        }
        let classSignature = methodSignature.getDeclaringClassSignature();
        let className = PrinterUtils_1.PrinterUtils.getStaticInvokeClassFullName(classSignature, this.context.getDeclaringArkNamespace());
        let methodName = methodSignature.getMethodSubSignature().getMethodName();
        let args = [];
        invokeExpr.getArgs().forEach(v => {
            args.push(this.valueToString(v));
        });
        let genericCode = this.genericTypesToString(invokeExpr.getRealGenericTypes());
        if (this.context.isInBuilderMethod()) {
            const res = this.transBuilderMethod(className, methodName, args, invokeExpr, genericCode);
            if (res !== null) {
                return res;
            }
        }
        if (className && className.length > 0 && methodName !== TSConst_1.SUPER_NAME) {
            return `${className}.${methodName}${genericCode}(${args.join(', ')})`;
        }
        return `${methodName}${genericCode}(${args.join(', ')})`;
    }
    genericTypesToString(types) {
        if (!types) {
            return '';
        }
        let code = this.typeArrayToString(types);
        if (code.length > 0) {
            return `<${code}>`;
        }
        return '';
    }
    typeArrayToString(types, split = ', ') {
        let typesStr = [];
        types.forEach(t => {
            typesStr.push(this.typeToString(t));
        });
        return typesStr.join(split);
    }
    static constToString(value) {
        if (value.getType().toString() === 'string') {
            return `'${PrinterUtils_1.PrinterUtils.escape(value.getValue())}'`;
        }
        else if (value.getType().toString() === TSConst_1.BIGINT_KEYWORD) {
            return `${value.getValue()}n`;
        }
        else {
            return value.getValue();
        }
    }
    exprToString(expr) {
        if (expr instanceof Expr_1.ArkInstanceInvokeExpr) {
            const isAttr = PrinterUtils_1.PrinterUtils.isComponentAttributeInvoke(expr);
            return `${this.instanceInvokeExprToString(expr, isAttr)}`;
        }
        if (expr instanceof Expr_1.ArkStaticInvokeExpr) {
            return `${this.staticInvokeExprToString(expr)}`;
        }
        if (expr instanceof Expr_1.ArkNewArrayExpr) {
            return `new Array<${this.typeToString(expr.getBaseType())}>(${expr.getSize()})`;
        }
        if (expr instanceof Expr_1.ArkNewExpr) {
            return `new ${this.typeToString(expr.getType())}()`;
        }
        if (expr instanceof Expr_1.ArkDeleteExpr) {
            return `delete ${this.valueToString(expr.getField())}`;
        }
        if (expr instanceof Expr_1.AbstractBinopExpr) {
            let op1 = expr.getOp1();
            let op2 = expr.getOp2();
            let operator = expr.getOperator();
            return `${this.valueToString(op1, false, operator)} ${operator} ${this.valueToString(op2, false, operator)}`;
        }
        if (expr instanceof Expr_1.ArkTypeOfExpr) {
            return `typeof(${this.valueToString(expr.getOp())})`;
        }
        if (expr instanceof Expr_1.ArkInstanceOfExpr) {
            return `${this.valueToString(expr.getOp())} instanceof ${this.typeToString(expr.getType())}`;
        }
        if (expr instanceof Expr_1.ArkCastExpr) {
            let baseOp = expr.getOp();
            return `${this.valueToString(baseOp)} as ${this.typeToString(expr.getType())}`;
        }
        if (expr instanceof Expr_1.ArkUnopExpr) {
            return `${expr.getOperator()}${this.valueToString(expr.getOp())}`;
        }
        if (expr instanceof Expr_1.ArkAwaitExpr) {
            return `await ${this.valueToString(expr.getPromise())}`;
        }
        if (expr instanceof Expr_1.ArkYieldExpr) {
            return `yield ${this.valueToString(expr.getYieldValue())}`;
        }
        logger.info(`exprToString ${expr.constructor} not support.`);
        // ArkPhiExpr
        return `${expr}`;
    }
    refToString(value) {
        if (value instanceof Ref_1.ArkInstanceFieldRef) {
            return `${this.valueToString(value.getBase())}.${value.getFieldName()}`;
        }
        if (value instanceof Ref_1.ArkStaticFieldRef) {
            return `${value.getFieldSignature().getBaseName()}.${value.getFieldName()}`;
        }
        if (value instanceof Ref_1.ArkArrayRef) {
            let index = value.getIndex();
            if (index instanceof Constant_1.Constant && index.getType() instanceof Type_1.StringType && PrinterUtils_1.PrinterUtils.isTemp(index.getValue())) {
                return `${this.valueToString(value.getBase())}[${this.valueToString(new Local_1.Local(index.getValue()))}]`;
            }
            return `${this.valueToString(value.getBase())}[${this.valueToString(value.getIndex())}]`;
        }
        if (value instanceof Ref_1.ArkThisRef) {
            return 'this';
        }
        // ArkCaughtExceptionRef
        logger.info(`refToString ${value.constructor} not support.`);
        return `${value}`;
    }
    valueToString(value, isLeftOp = false, operator) {
        if (value instanceof Expr_1.AbstractExpr) {
            return this.exprToString(value);
        }
        if (value instanceof Ref_1.AbstractRef) {
            return this.refToString(value);
        }
        if (value instanceof Constant_1.Constant) {
            return SourceTransformer.constToString(value);
        }
        if (value instanceof Local_1.Local) {
            return this.localToString(value, isLeftOp, operator);
        }
        logger.info(`valueToString ${value.constructor} not support.`);
        return `${value}`;
    }
    localToString(value, isLeftOp = false, operator) {
        if (PrinterUtils_1.PrinterUtils.isAnonymousMethod(value.getName())) {
            let methodSignature = value.getType().getMethodSignature();
            let anonymousMethod = this.context.getMethod(methodSignature);
            if (anonymousMethod) {
                return this.anonymousMethodToString(anonymousMethod, this.context.getPrinter().getIndent());
            }
        }
        if (PrinterUtils_1.PrinterUtils.isAnonymousClass(value.getName())) {
            let clsSignature = value.getType().getClassSignature();
            let cls = this.context.getClass(clsSignature);
            if (cls) {
                return this.anonymousClassToString(cls, this.context.getPrinter().getIndent());
            }
        }
        if (operator === Expr_1.NormalBinaryOperator.Division || operator === Expr_1.NormalBinaryOperator.Multiplication || operator === Expr_1.NormalBinaryOperator.Remainder) {
            if (PrinterUtils_1.PrinterUtils.isTemp(value.getName())) {
                let stmt = value.getDeclaringStmt();
                if (stmt instanceof Stmt_1.ArkAssignStmt && stmt.getRightOp() instanceof Expr_1.ArkNormalBinopExpr) {
                    return `(${this.context.transTemp2Code(value, isLeftOp)})`;
                }
            }
        }
        return this.context.transTemp2Code(value, isLeftOp);
    }
    literalObjectToString(type) {
        let name = type.getClassSignature().getClassName();
        if (PrinterUtils_1.PrinterUtils.isAnonymousClass(name)) {
            let cls = this.context.getClass(type.getClassSignature());
            if (cls) {
                return this.anonymousClassToString(cls, this.context.getPrinter().getIndent());
            }
        }
        return name;
    }
    typeToString(type) {
        if (type instanceof Type_1.LiteralType) {
            return this.literalType2string(type);
        }
        if (type instanceof Type_1.PrimitiveType || type instanceof Type_1.GenericType) {
            return type.getName();
        }
        if (type instanceof Type_1.UnionType || type instanceof Type_1.IntersectionType) {
            return this.multipleType2string(type);
        }
        if (type instanceof Type_1.UnknownType) {
            return 'any';
        }
        if (type instanceof Type_1.VoidType) {
            return 'void';
        }
        if (type instanceof Type_1.ClassType) {
            return this.classType2string(type);
        }
        if (type instanceof Type_1.ArrayType) {
            return this.arrayType2string(type);
        }
        if (type instanceof Type_1.TupleType) {
            return this.tupleType2string(type);
        }
        if (type instanceof Type_1.FunctionType) {
            let methodSignature = type.getMethodSignature();
            let method = this.context.getMethod(methodSignature);
            if (method && PrinterUtils_1.PrinterUtils.isAnonymousMethod(method.getName())) {
                return new SourceMethod_1.SourceMethod(method).toArrowFunctionTypeString();
            }
        }
        if (type instanceof Type_1.UnclearReferenceType) {
            return this.unclearReferenceType2string(type);
        }
        if (type instanceof Type_1.AliasType) {
            return this.aliasType2string(type);
        }
        if (type instanceof TypeExpr_1.KeyofTypeExpr) {
            return this.keyofTypeExpr2string(type);
        }
        if (type instanceof TypeExpr_1.TypeQueryExpr) {
            return this.typeQueryExpr2string(type);
        }
        if (!type) {
            return 'any';
        }
        logger.info(`valueToString ${type.constructor} not support.`);
        return type.toString();
    }
    literalType2string(type) {
        let literalName = type.getLiteralName();
        if (typeof literalName === 'string' && literalName.endsWith('Keyword')) {
            return literalName.substring(0, literalName.length - 'Keyword'.length).toLowerCase();
        }
        return `${literalName}`;
    }
    multipleType2string(type) {
        let typesStr = [];
        for (const member of type.getTypes()) {
            if (member instanceof Type_1.UnionType || member instanceof Type_1.IntersectionType) {
                typesStr.push(`(${this.typeToString(member)})`);
            }
            else {
                typesStr.push(this.typeToString(member));
            }
        }
        if (type instanceof Type_1.UnionType) {
            return typesStr.join(' | ');
        }
        else {
            return typesStr.join(' & ');
        }
    }
    arrayType2string(type) {
        const readonly = type.getReadonlyFlag() ? 'readonly ' : '';
        const dimensions = [];
        for (let i = 0; i < type.getDimension(); i++) {
            dimensions.push('[]');
        }
        let baseType = type.getBaseType();
        if (baseType instanceof Type_1.UnionType || baseType instanceof Type_1.IntersectionType || baseType instanceof TypeExpr_1.AbstractTypeExpr) {
            return `${readonly}(${this.typeToString(baseType)})${dimensions.join('')}`;
        }
        return `${readonly}${this.typeToString(baseType)}${dimensions.join('')}`;
    }
    tupleType2string(type) {
        const readonly = type.getReadonlyFlag() ? 'readonly ' : '';
        let typesStr = [];
        for (const member of type.getTypes()) {
            typesStr.push(this.typeToString(member));
        }
        return `${readonly}[${typesStr.join(', ')}]`;
    }
    aliasType2string(type) {
        var _a;
        let typesStr = [];
        let genericTypes = (_a = type.getRealGenericTypes()) !== null && _a !== void 0 ? _a : type.getGenericTypes();
        if (genericTypes) {
            for (const gType of genericTypes) {
                typesStr.push(this.typeToString(gType));
            }
        }
        if (typesStr.length > 0) {
            return `${type.getName()}<${typesStr.join(', ')}>`;
        }
        return type.getName();
    }
    keyofTypeExpr2string(type) {
        if (type.getOpType() instanceof Type_1.UnionType || type.getOpType() instanceof Type_1.IntersectionType) {
            return `keyof (${this.typeToString(type.getOpType())})`;
        }
        return `keyof ${this.typeToString(type.getOpType())}`;
    }
    typeQueryExpr2string(type) {
        const gTypes = type.getGenerateTypes();
        const genericStr = this.genericTypesToString(gTypes);
        const opValue = type.getOpValue();
        if (opValue instanceof ArkBaseModel_1.ArkBaseModel) {
            if (opValue instanceof ArkClass_1.ArkClass || opValue instanceof ArkMethod_1.ArkMethod || opValue instanceof ArkNamespace_1.ArkNamespace || opValue instanceof ArkField_1.ArkField) {
                return `typeof ${opValue.getName()}${genericStr}`;
            }
            else if (opValue instanceof ArkExport_1.ExportInfo) {
                return `typeof ${opValue.getExportClauseName()}${genericStr}`;
            }
            else if (opValue instanceof ArkImport_1.ImportInfo) {
                return `typeof ${opValue.getImportClauseName()}${genericStr}`;
            }
            else {
                return `typeof *invalid*`;
            }
        }
        else {
            return `typeof ${this.valueToString(opValue)}${genericStr}`;
        }
    }
    unclearReferenceType2string(type) {
        let genericTypes = type.getGenericTypes();
        if (genericTypes.length > 0) {
            return `${type.getName()}<${genericTypes.map(value => this.typeToString(value)).join(', ')}>`;
        }
        return type.getName();
    }
    classType2string(type) {
        const name = PrinterUtils_1.PrinterUtils.getStaticInvokeClassFullName(type.getClassSignature());
        if (PrinterUtils_1.PrinterUtils.isDefaultClass(name)) {
            return 'any';
        }
        if (PrinterUtils_1.PrinterUtils.isAnonymousClass(name)) {
            let cls = this.context.getClass(type.getClassSignature());
            if (cls && cls.getCategory() === ArkClass_1.ClassCategory.TYPE_LITERAL) {
                return this.anonymousClassToString(cls, this.context.getPrinter().getIndent());
            }
            return 'Object';
        }
        let genericTypes = type.getRealGenericTypes();
        if (genericTypes && genericTypes.length > 0) {
            return `${name}${this.genericTypesToString(genericTypes)}`;
        }
        return name;
    }
}
exports.SourceTransformer = SourceTransformer;
