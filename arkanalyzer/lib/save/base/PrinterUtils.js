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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PrinterUtils = exports.CLASS_CATEGORY_COMPONENT = void 0;
const Constant_1 = require("../../core/base/Constant");
const Expr_1 = require("../../core/base/Expr");
const Local_1 = require("../../core/base/Local");
const Stmt_1 = require("../../core/base/Stmt");
const EtsConst_1 = require("../../core/common/EtsConst");
const ArkClass_1 = require("../../core/model/ArkClass");
const logger_1 = __importStar(require("../../utils/logger"));
const Const_1 = require("../../core/common/Const");
const ohos_typescript_1 = __importDefault(require("ohos-typescript"));
const Const_2 = require("../../core/common/Const");
const logger = logger_1.default.getLogger(logger_1.LOG_MODULE_TYPE.ARKANALYZER, 'PrinterUtils');
exports.CLASS_CATEGORY_COMPONENT = 100;
class PrinterUtils {
    static isAnonymousClass(name) {
        return name.startsWith(Const_1.ANONYMOUS_CLASS_PREFIX);
    }
    static isDefaultClass(name) {
        return name === Const_1.DEFAULT_ARK_CLASS_NAME;
    }
    static isAnonymousMethod(name) {
        return name.startsWith(Const_1.ANONYMOUS_METHOD_PREFIX);
    }
    static isConstructorMethod(name) {
        return name === 'constructor';
    }
    static isDeIncrementStmt(stmt, op) {
        if (!(stmt instanceof Stmt_1.ArkAssignStmt)) {
            return false;
        }
        let leftOp = stmt.getLeftOp();
        let rightOp = stmt.getRightOp();
        if (!(leftOp instanceof Local_1.Local) || !(rightOp instanceof Expr_1.ArkNormalBinopExpr)) {
            return false;
        }
        let op1 = rightOp.getOp1();
        let op2 = rightOp.getOp2();
        let operator = rightOp.getOperator();
        if (!(op1 instanceof Local_1.Local) || !(op2 instanceof Constant_1.Constant)) {
            return false;
        }
        return leftOp.getName() === op1.getName() && operator === op && op2.getValue() === '1';
    }
    static isTemp(name) {
        return name.startsWith(Const_2.TEMP_LOCAL_PREFIX);
    }
    static getOriginType(cls) {
        if (cls.hasComponentDecorator()) {
            return exports.CLASS_CATEGORY_COMPONENT;
        }
        return cls.getCategory();
    }
    static isComponentPop(invokeExpr) {
        let className = invokeExpr.getMethodSignature().getDeclaringClassSignature().getClassName();
        let methodName = invokeExpr.getMethodSignature().getMethodSubSignature().getMethodName();
        if (methodName === EtsConst_1.COMPONENT_POP_FUNCTION && ((0, EtsConst_1.isEtsSystemComponent)(className) || EtsConst_1.SPECIAL_CONTAINER_COMPONENT.has(className))) {
            return true;
        }
        return false;
    }
    static isComponentCreate(invokeExpr) {
        let className = invokeExpr.getMethodSignature().getDeclaringClassSignature().getClassName();
        let methodName = invokeExpr.getMethodSignature().getMethodSubSignature().getMethodName();
        if (methodName === EtsConst_1.COMPONENT_CREATE_FUNCTION && ((0, EtsConst_1.isEtsSystemComponent)(className) || EtsConst_1.SPECIAL_CONTAINER_COMPONENT.has(className))) {
            return true;
        }
        return false;
    }
    static isConstructorInvoke(invokeExpr) {
        let methodName = invokeExpr.getMethodSignature().getMethodSubSignature().getMethodName();
        return this.isConstructorMethod(methodName);
    }
    static isComponentAttributeInvoke(invokeExpr, visitor = new Set()) {
        if (visitor.has(invokeExpr)) {
            return false;
        }
        visitor.add(invokeExpr);
        let base = invokeExpr.getBase();
        if (!(base instanceof Local_1.Local)) {
            logger.error(`PrinterUtils->isComponentAttributeInvoke illegal invoke expr ${invokeExpr}`);
            return false;
        }
        let stmt = base.getDeclaringStmt();
        if (!stmt || !(stmt instanceof Stmt_1.ArkAssignStmt)) {
            return false;
        }
        let rightOp = stmt.getRightOp();
        if (rightOp instanceof Expr_1.ArkInstanceInvokeExpr) {
            return PrinterUtils.isComponentAttributeInvoke(rightOp, visitor);
        }
        if (rightOp instanceof Expr_1.ArkStaticInvokeExpr) {
            return PrinterUtils.isComponentCreate(rightOp);
        }
        return false;
    }
    static isComponentIfBranchInvoke(invokeExpr) {
        let className = invokeExpr.getMethodSignature().getDeclaringClassSignature().getClassName();
        let methodName = invokeExpr.getMethodSignature().getMethodSubSignature().getMethodName();
        if (className === EtsConst_1.COMPONENT_IF && methodName === EtsConst_1.COMPONENT_BRANCH_FUNCTION) {
            return true;
        }
        return false;
    }
    static isComponentIfElseInvoke(invokeExpr) {
        let className = invokeExpr.getMethodSignature().getDeclaringClassSignature().getClassName();
        let methodName = invokeExpr.getMethodSignature().getMethodSubSignature().getMethodName();
        if (className === EtsConst_1.COMPONENT_IF && methodName === EtsConst_1.COMPONENT_BRANCH_FUNCTION) {
            let arg0 = invokeExpr.getArg(0);
            if (arg0.getValue() === '1') {
                return true;
            }
        }
        return false;
    }
    static getStaticInvokeClassFullName(classSignature, namespace) {
        let code = [];
        let declareNamespace = classSignature.getDeclaringNamespaceSignature();
        while (declareNamespace !== null) {
            let namespaceName = declareNamespace.getNamespaceName();
            if (namespaceName.length > 0 && namespaceName !== (namespace === null || namespace === void 0 ? void 0 : namespace.getName())) {
                code.unshift(namespaceName);
                declareNamespace = declareNamespace.getDeclaringNamespaceSignature();
            }
            else {
                break;
            }
        }
        let className = classSignature.getClassName();
        if (className && className.length > 0 && !PrinterUtils.isDefaultClass(className)) {
            code.push(className);
        }
        return code.join('.');
    }
    static isIdentifierText(text) {
        let ch = text.charCodeAt(0);
        if (!ohos_typescript_1.default.isIdentifierStart(ch, ohos_typescript_1.default.ScriptTarget.Latest)) {
            return false;
        }
        for (let i = 1; i < text.length; i++) {
            if (!ohos_typescript_1.default.isIdentifierPart(text.charCodeAt(i), ohos_typescript_1.default.ScriptTarget.Latest)) {
                return false;
            }
        }
        return true;
    }
    static escape(text) {
        return text
            .replace(/\\/g, '\\\\')
            .replace(/\f/g, `\\f`)
            .replace(/\n/g, `\\n`)
            .replace(/\r/g, '\\r')
            .replace(/\t/g, '\\t')
            .replace(/\v/g, '\\v')
            .replace(/\?/g, '\\?')
            .replace(/\'/g, "\\'")
            .replace(/\"/g, '\\"');
    }
}
exports.PrinterUtils = PrinterUtils;
PrinterUtils.classOriginTypeToString = new Map([
    [ArkClass_1.ClassCategory.CLASS, 'class'],
    [ArkClass_1.ClassCategory.STRUCT, 'struct'],
    [ArkClass_1.ClassCategory.INTERFACE, 'interface'],
    [ArkClass_1.ClassCategory.ENUM, 'enum'],
    [ArkClass_1.ClassCategory.TYPE_LITERAL, 'typeliteral'],
    [ArkClass_1.ClassCategory.OBJECT, 'object'],
    [exports.CLASS_CATEGORY_COMPONENT, 'component'],
]);
