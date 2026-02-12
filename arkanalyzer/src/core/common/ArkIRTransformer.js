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
exports.ArkIRTransformer = exports.DummyStmt = void 0;
const Expr_1 = require("../base/Expr");
const Ref_1 = require("../base/Ref");
const ts = __importStar(require("ohos-typescript"));
const Local_1 = require("../base/Local");
const Stmt_1 = require("../base/Stmt");
const Type_1 = require("../base/Type");
const ValueUtil_1 = require("./ValueUtil");
const ArkSignature_1 = require("../model/ArkSignature");
const IRUtils_1 = require("./IRUtils");
const ArkMethod_1 = require("../model/ArkMethod");
const ArkMethodBuilder_1 = require("../model/builder/ArkMethodBuilder");
const ArkSignatureBuilder_1 = require("../model/builder/ArkSignatureBuilder");
const EtsConst_1 = require("./EtsConst");
const Position_1 = require("../base/Position");
const ModelUtils_1 = require("./ModelUtils");
const Builtin_1 = require("./Builtin");
const TSConst_1 = require("./TSConst");
const builderUtils_1 = require("../model/builder/builderUtils");
const ArkValueTransformer_1 = require("./ArkValueTransformer");
const ArkImport_1 = require("../model/ArkImport");
const TypeExpr_1 = require("../base/TypeExpr");
const ArkClassBuilder_1 = require("../model/builder/ArkClassBuilder");
const ArkClass_1 = require("../model/ArkClass");
const ArkBaseModel_1 = require("../model/ArkBaseModel");
class DummyStmt extends Stmt_1.Stmt {
    constructor(text) {
        super();
        this.text = text;
    }
    toString() {
        return this.text;
    }
}
exports.DummyStmt = DummyStmt;
class ArkIRTransformer {
    constructor(sourceFile, declaringMethod) {
        this.inBuilderMethod = false;
        this.builderMethodContextFlag = false;
        this.stmtsHaveOriginalText = new Set();
        this.sourceFile = sourceFile;
        this.declaringMethod = declaringMethod;
        this.inBuilderMethod = ModelUtils_1.ModelUtils.isArkUIBuilderMethod(declaringMethod);
        this.arkValueTransformer = new ArkValueTransformer_1.ArkValueTransformer(this, sourceFile, this.declaringMethod);
    }
    getLocals() {
        return this.arkValueTransformer.getLocals();
    }
    getGlobals() {
        return this.arkValueTransformer.getGlobals();
    }
    getThisLocal() {
        return this.arkValueTransformer.getThisLocal();
    }
    getAliasTypeMap() {
        return this.arkValueTransformer.getAliasTypeMap();
    }
    prebuildStmts() {
        const stmts = [];
        let index = 0;
        for (const methodParameter of this.declaringMethod.getParameters()) {
            const parameterRef = new Ref_1.ArkParameterRef(index, methodParameter.getType());
            const stmt = new Stmt_1.ArkAssignStmt(this.arkValueTransformer.addNewLocal(methodParameter.getName(), parameterRef.getType()), parameterRef);
            const paramPosition = this.declaringMethod.getBodyBuilder()?.getParamsPositions().get(methodParameter.getName()) ?? Position_1.FullPosition.DEFAULT;
            stmt.setOperandOriginalPositions([paramPosition, paramPosition]);
            stmts.push(stmt);
            index++;
        }
        const thisRef = new Ref_1.ArkThisRef(this.arkValueTransformer.getThisLocal().getType());
        stmts.push(new Stmt_1.ArkAssignStmt(this.arkValueTransformer.getThisLocal(), thisRef));
        return stmts;
    }
    tsNodeToStmts(node) {
        let stmts = [];
        if (ts.isExpressionStatement(node)) {
            stmts = this.expressionStatementToStmts(node);
        }
        else if (ts.isTypeAliasDeclaration(node)) {
            stmts = this.typeAliasDeclarationToStmts(node);
        }
        else if (ts.isBlock(node)) {
            stmts = this.blockToStmts(node);
        }
        else if (ts.isForStatement(node)) {
            stmts = this.forStatementToStmts(node);
        }
        else if (ts.isForInStatement(node) || ts.isForOfStatement(node)) {
            stmts = this.rangeForStatementToStmts(node);
        }
        else if (ts.isWhileStatement(node)) {
            stmts = this.whileStatementToStmts(node);
        }
        else if (ts.isDoStatement(node)) {
            stmts = this.doStatementToStmts(node);
        }
        else if (ts.isVariableStatement(node)) {
            stmts = this.variableStatementToStmts(node);
        }
        else if (ts.isVariableDeclarationList(node)) {
            stmts = this.variableDeclarationListToStmts(node);
        }
        else if (ts.isIfStatement(node)) {
            stmts = this.ifStatementToStmts(node);
        }
        else if (ts.isBreakStatement(node) || ts.isContinueStatement(node)) {
            stmts = this.gotoStatementToStmts(node);
        }
        else if (ts.isThrowStatement(node)) {
            stmts = this.throwStatementToStmts(node);
        }
        else if (ts.isCatchClause(node)) {
            stmts = this.catchClauseToStmts(node);
        }
        else if (ts.isReturnStatement(node)) {
            stmts = this.returnStatementToStmts(node);
        }
        else if (ts.isFunctionDeclaration(node)) {
            stmts = this.functionDeclarationToStmts(node);
        }
        else if (ts.isExportAssignment(node)) {
            stmts = this.expressionInExportToStmts(node.expression);
        }
        else if (ts.isClassDeclaration(node)) {
            stmts = this.classDeclarationToStmts(node);
        }
        else if (ts.isParameter(node)) {
            stmts = this.parameterToStmts(node);
        }
        this.mapStmtsToTsStmt(stmts, node);
        if (stmts.length > 0) {
            IRUtils_1.IRUtils.setComments(stmts[0], node, this.sourceFile, this.declaringMethod.getDeclaringArkFile().getScene().getOptions());
        }
        return stmts;
    }
    tsNodeToValueAndStmts(node) {
        return this.arkValueTransformer.tsNodeToValueAndStmts(node);
    }
    functionDeclarationToStmts(functionDeclarationNode) {
        const declaringClass = this.declaringMethod.getDeclaringArkClass();
        const arkMethod = new ArkMethod_1.ArkMethod();
        if (this.builderMethodContextFlag) {
            ModelUtils_1.ModelUtils.implicitArkUIBuilderMethods.add(arkMethod);
        }
        (0, ArkMethodBuilder_1.buildArkMethodFromArkClass)(functionDeclarationNode, declaringClass, arkMethod, this.sourceFile, this.declaringMethod);
        return [];
    }
    classDeclarationToStmts(node) {
        const cls = new ArkClass_1.ArkClass();
        const declaringArkNamespace = this.declaringMethod.getDeclaringArkClass().getDeclaringArkNamespace();
        if (declaringArkNamespace) {
            cls.setDeclaringArkNamespace(declaringArkNamespace);
        }
        cls.setDeclaringArkFile(this.declaringMethod.getDeclaringArkFile());
        (0, ArkClassBuilder_1.buildNormalArkClassFromArkMethod)(node, cls, this.sourceFile, this.declaringMethod);
        return [];
    }
    // This is only used to add class property assign stmts into constructor when it is with parameter property.
    parameterPropertyToStmts(paramNode) {
        let stmts = [];
        let fieldName;
        if (ts.isIdentifier(paramNode.name)) {
            fieldName = paramNode.name.text;
        }
        else if (ts.isObjectBindingPattern(paramNode.name)) {
            // TODO
            return stmts;
        }
        else if (ts.isArrayBindingPattern(paramNode.name)) {
            // TODO
            return stmts;
        }
        else {
            return stmts;
        }
        if (paramNode.modifiers === undefined || !ts.isIdentifier(paramNode.name)) {
            return [];
        }
        const arkClass = this.declaringMethod.getDeclaringArkClass();
        const fieldSignature = arkClass.getFieldWithName(fieldName)?.getSignature();
        const paramLocal = Array.from(this.getLocals()).find(local => local.getName() === fieldName);
        if (fieldSignature === undefined || paramLocal === undefined) {
            return [];
        }
        const leftOp = new Ref_1.ArkInstanceFieldRef(this.getThisLocal(), fieldSignature);
        const fieldAssignStmt = new Stmt_1.ArkAssignStmt(leftOp, paramLocal);
        fieldAssignStmt.setOperandOriginalPositions([Position_1.FullPosition.DEFAULT, Position_1.FullPosition.DEFAULT, Position_1.FullPosition.DEFAULT]);
        // If the parameter has initializer, the related stmts should be added into class instance init method.
        const instInitMethodCfg = arkClass.getInstanceInitMethod().getBody()?.getCfg();
        const instInitStmts = instInitMethodCfg?.getStartingBlock()?.getStmts();
        if (paramNode.initializer && instInitStmts && instInitMethodCfg) {
            const { value: instanceInitValue, valueOriginalPositions: instanceInitPositions, stmts: instanceInitStmts, } = this.tsNodeToValueAndStmts(paramNode.initializer);
            const instanceAssignStmt = new Stmt_1.ArkAssignStmt(leftOp, instanceInitValue);
            instanceAssignStmt.setOperandOriginalPositions([Position_1.FullPosition.DEFAULT, Position_1.FullPosition.DEFAULT, ...instanceInitPositions]);
            const newInstanceInitStmts = [...instanceInitStmts, instanceAssignStmt];
            // All these stmts will be added into instance init method, while that method has completed the building. So all new stmts should set cfg here.
            newInstanceInitStmts.forEach(stmt => stmt.setCfg(instInitMethodCfg));
            // The last stmt of instance init method is return stmt, so all the initializer stmts should be added before return stmt.
            instInitStmts.splice(instInitStmts.length - 1, 0, ...newInstanceInitStmts);
        }
        return [fieldAssignStmt];
    }
    parameterToStmts(paramNode) {
        if (this.declaringMethod.getName() === TSConst_1.CONSTRUCTOR_NAME && paramNode.modifiers) {
            return this.parameterPropertyToStmts(paramNode);
        }
        let stmts = [];
        if (paramNode.initializer === undefined) {
            return stmts;
        }
        let paramName;
        if (ts.isIdentifier(paramNode.name)) {
            paramName = paramNode.name.text;
        }
        else if (ts.isObjectBindingPattern(paramNode.name)) {
            // TODO
            return stmts;
        }
        else if (ts.isArrayBindingPattern(paramNode.name)) {
            // TODO
            return stmts;
        }
        else {
            return stmts;
        }
        const paramLocal = Array.from(this.getLocals()).find(local => local.getName() === paramName);
        if (paramLocal === undefined) {
            return stmts;
        }
        const { value: paramInitValue, valueOriginalPositions: paramInitPositions, stmts: paramInitStmts, } = this.tsNodeToValueAndStmts(paramNode.initializer);
        stmts.push(...paramInitStmts);
        const ifStmt = new Stmt_1.ArkIfStmt(new Expr_1.ArkConditionExpr(paramLocal, ValueUtil_1.ValueUtil.getUndefinedConst(), Expr_1.RelationalBinaryOperator.Equality));
        ifStmt.setOperandOriginalPositions([Position_1.FullPosition.DEFAULT, Position_1.FullPosition.DEFAULT]);
        stmts.push(ifStmt);
        const currConditionalOperatorIndex = this.arkValueTransformer.conditionalOperatorNo++;
        stmts.push(new DummyStmt(ArkIRTransformer.DUMMY_CONDITIONAL_OPERATOR_IF_TRUE_STMT + currConditionalOperatorIndex));
        const assignStmt = new Stmt_1.ArkAssignStmt(paramLocal, paramInitValue);
        assignStmt.setOperandOriginalPositions([Position_1.FullPosition.DEFAULT, ...paramInitPositions]);
        stmts.push(assignStmt);
        stmts.push(new DummyStmt(ArkIRTransformer.DUMMY_CONDITIONAL_OPERATOR_IF_FALSE_STMT + currConditionalOperatorIndex));
        stmts.push(new DummyStmt(ArkIRTransformer.DUMMY_CONDITIONAL_OPERATOR_END_STMT + currConditionalOperatorIndex));
        return stmts;
    }
    returnStatementToStmts(returnStatement) {
        const stmts = [];
        if (returnStatement.expression) {
            let { value: exprValue, valueOriginalPositions: exprPositions, stmts: exprStmts } = this.tsNodeToValueAndStmts(returnStatement.expression);
            exprStmts.forEach(stmt => stmts.push(stmt));
            if (IRUtils_1.IRUtils.moreThanOneAddress(exprValue)) {
                ({ value: exprValue, valueOriginalPositions: exprPositions, stmts: exprStmts } = this.generateAssignStmtForValue(exprValue, exprPositions));
                exprStmts.forEach(stmt => stmts.push(stmt));
            }
            const returnStmt = new Stmt_1.ArkReturnStmt(exprValue);
            returnStmt.setOperandOriginalPositions(exprPositions);
            stmts.push(returnStmt);
            if (this.declaringMethod.getSubSignature().getReturnType() instanceof Type_1.UnknownType) {
                this.declaringMethod.getSubSignature().setReturnType(exprValue.getType());
            }
            return stmts;
        }
        stmts.push(new Stmt_1.ArkReturnVoidStmt());
        if (this.declaringMethod.getSubSignature().getReturnType() instanceof Type_1.UnknownType) {
            if (this.declaringMethod.containsModifier(ArkBaseModel_1.ModifierType.ASYNC)) {
                const promise = this.declaringMethod.getDeclaringArkFile().getScene().getSdkGlobal(TSConst_1.PROMISE);
                if (promise instanceof ArkClass_1.ArkClass) {
                    this.declaringMethod.getSubSignature().setReturnType(new Type_1.ClassType(promise.getSignature()));
                }
                else {
                    this.declaringMethod.getSubSignature().setReturnType(new Type_1.UnclearReferenceType(TSConst_1.PROMISE, [Type_1.VoidType.getInstance()]));
                }
            }
            else {
                this.declaringMethod.getSubSignature().setReturnType(Type_1.VoidType.getInstance());
            }
        }
        return stmts;
    }
    blockToStmts(block) {
        const stmts = [];
        for (const statement of block.statements) {
            this.tsNodeToStmts(statement).forEach(stmt => stmts.push(stmt));
        }
        return stmts;
    }
    expressionStatementToStmts(expressionStatement) {
        const exprNode = expressionStatement.expression;
        const { value: exprValue, valueOriginalPositions: exprPositions, stmts: stmts } = this.tsNodeToValueAndStmts(exprNode);
        if (exprValue instanceof Expr_1.AbstractInvokeExpr) {
            this.addInvokeStmts(exprValue, exprPositions, stmts);
        }
        else if (this.shouldGenerateExtraAssignStmt(exprNode)) {
            const { stmts: exprStmts } = this.generateAssignStmtForValue(exprValue, exprPositions);
            exprStmts.forEach(stmt => stmts.push(stmt));
        }
        return stmts;
    }
    addInvokeStmts(invokeExpr, exprPositions, stmts) {
        const invokeStmt = new Stmt_1.ArkInvokeStmt(invokeExpr);
        invokeStmt.setOperandOriginalPositions(exprPositions);
        stmts.push(invokeStmt);
        let hasRepeat = false;
        for (const stmt of stmts) {
            if (stmt instanceof Stmt_1.ArkAssignStmt && stmt.getRightOp() instanceof Expr_1.ArkStaticInvokeExpr) {
                const rightOp = stmt.getRightOp();
                if (rightOp.getMethodSignature().getMethodSubSignature().getMethodName() === EtsConst_1.COMPONENT_REPEAT) {
                    const createMethodSignature = ArkSignatureBuilder_1.ArkSignatureBuilder.buildMethodSignatureFromClassNameAndMethodName(EtsConst_1.COMPONENT_REPEAT, EtsConst_1.COMPONENT_CREATE_FUNCTION);
                    const createInvokeExpr = new Expr_1.ArkStaticInvokeExpr(createMethodSignature, rightOp.getArgs());
                    stmt.setRightOp(createInvokeExpr);
                    hasRepeat = true;
                }
            }
        }
        if (hasRepeat) {
            const popMethodSignature = ArkSignatureBuilder_1.ArkSignatureBuilder.buildMethodSignatureFromClassNameAndMethodName(EtsConst_1.COMPONENT_REPEAT, EtsConst_1.COMPONENT_POP_FUNCTION);
            const popInvokeExpr = new Expr_1.ArkStaticInvokeExpr(popMethodSignature, []);
            const popInvokeStmt = new Stmt_1.ArkInvokeStmt(popInvokeExpr);
            stmts.push(popInvokeStmt);
        }
    }
    shouldGenerateExtraAssignStmt(expression) {
        if (ts.isParenthesizedExpression(expression)) {
            return this.shouldGenerateExtraAssignStmt(expression.expression);
        }
        if ((ts.isBinaryExpression(expression) &&
            (expression.operatorToken.kind === ts.SyntaxKind.FirstAssignment ||
                ArkValueTransformer_1.ArkValueTransformer.isCompoundAssignmentOperator(expression.operatorToken.kind))) ||
            ts.isEtsComponentExpression(expression) ||
            ts.isVoidExpression(expression) ||
            ts.isNewExpression(expression) ||
            ts.isCallExpression(expression) ||
            (ts.isPrefixUnaryExpression(expression) &&
                (expression.operator === ts.SyntaxKind.PlusPlusToken || expression.operator === ts.SyntaxKind.MinusMinusToken)) ||
            (ts.isPostfixUnaryExpression(expression) &&
                (expression.operator === ts.SyntaxKind.PlusPlusToken || expression.operator === ts.SyntaxKind.MinusMinusToken))) {
            return false;
        }
        return true;
    }
    typeAliasDeclarationToStmts(typeAliasDeclaration) {
        const aliasName = typeAliasDeclaration.name.text;
        const rightOp = typeAliasDeclaration.type;
        let rightType = this.arkValueTransformer.resolveTypeNode(rightOp);
        if (rightType instanceof TypeExpr_1.AbstractTypeExpr) {
            rightType = rightType.getType();
        }
        const aliasType = new Type_1.AliasType(aliasName, rightType, new ArkSignature_1.AliasTypeSignature(aliasName, this.declaringMethod.getSignature()));
        if (typeAliasDeclaration.typeParameters) {
            const genericTypes = (0, builderUtils_1.buildTypeParameters)(typeAliasDeclaration.typeParameters, this.sourceFile, this.declaringMethod);
            aliasType.setGenericTypes(genericTypes);
            aliasType.setOriginalType((0, builderUtils_1.buildGenericType)(rightType, aliasType));
            rightType = aliasType.getOriginalType();
        }
        let expr = this.generateAliasTypeExpr(rightOp, aliasType);
        if ((ts.isTypeQueryNode(rightOp) || ts.isTypeReferenceNode(rightOp)) && rightOp.typeArguments) {
            let realGenericTypes = [];
            rightOp.typeArguments.forEach(typeArgument => {
                realGenericTypes.push(this.arkValueTransformer.resolveTypeNode(typeArgument));
            });
            expr.setRealGenericTypes(realGenericTypes);
        }
        const modifiers = typeAliasDeclaration.modifiers ? (0, builderUtils_1.buildModifiers)(typeAliasDeclaration) : 0;
        aliasType.setModifiers(modifiers);
        const aliasTypeDefineStmt = new Stmt_1.ArkAliasTypeDefineStmt(aliasType, expr);
        const leftPosition = Position_1.FullPosition.buildFromNode(typeAliasDeclaration.name, this.sourceFile);
        const rightPosition = Position_1.FullPosition.buildFromNode(rightOp, this.sourceFile);
        const operandOriginalPositions = [leftPosition, rightPosition];
        aliasTypeDefineStmt.setOperandOriginalPositions(operandOriginalPositions);
        this.getAliasTypeMap().set(aliasName, [aliasType, aliasTypeDefineStmt]);
        return [aliasTypeDefineStmt];
    }
    generateAliasTypeExpr(rightOp, aliasType) {
        let rightType = aliasType.getOriginalType();
        let expr;
        if (ts.isImportTypeNode(rightOp)) {
            expr = this.resolveImportTypeNode(rightOp);
        }
        else if (ts.isTypeQueryNode(rightOp)) {
            const localName = rightOp.exprName.getText(this.sourceFile);
            const originalLocal = Array.from(this.arkValueTransformer.getLocals()).find(local => local.getName() === localName);
            if (originalLocal === undefined || rightType instanceof Type_1.UnclearReferenceType) {
                expr = new Expr_1.AliasTypeExpr(new Local_1.Local(localName, rightType), true);
            }
            else {
                expr = new Expr_1.AliasTypeExpr(originalLocal, true);
            }
        }
        else if (ts.isTypeReferenceNode(rightOp)) {
            // For type A = B<number> stmt and B is also an alias type with the same scope of A,
            // rightType here is AliasType with real generic type number.
            // The originalObject in expr should be the object without real generic type, so try to find it in this scope.
            if (rightType instanceof Type_1.AliasType) {
                const existAliasType = this.getAliasTypeMap().get(rightType.getName());
                if (existAliasType) {
                    expr = new Expr_1.AliasTypeExpr(existAliasType[0], false);
                }
                else {
                    expr = new Expr_1.AliasTypeExpr(rightType, false);
                }
            }
            else {
                expr = new Expr_1.AliasTypeExpr(rightType, false);
            }
        }
        else {
            expr = new Expr_1.AliasTypeExpr(rightType, false);
            // 对于type A = {x:1, y:2}语句，当前阶段即可精确获取ClassType类型，需找到对应的ArkClass作为originalObject
            // 对于其他情况此处为UnclearReferenceTye并由类型推导进行查找和处理
            if (rightType instanceof Type_1.ClassType) {
                const classObject = ModelUtils_1.ModelUtils.getClassWithName(rightType.getClassSignature().getClassName(), this.declaringMethod.getDeclaringArkClass());
                if (classObject) {
                    expr.setOriginalObject(classObject);
                }
            }
        }
        return expr;
    }
    resolveImportTypeNode(importTypeNode) {
        const importType = 'typeAliasDefine';
        let importFrom = '';
        let importClauseName = '';
        if (ts.isLiteralTypeNode(importTypeNode.argument)) {
            if (ts.isStringLiteral(importTypeNode.argument.literal)) {
                importFrom = importTypeNode.argument.literal.text;
            }
        }
        const importQualifier = importTypeNode.qualifier;
        if (importQualifier !== undefined) {
            importClauseName = importQualifier.getText(this.sourceFile);
        }
        let importInfo = new ArkImport_1.ImportInfo();
        importInfo.build(importClauseName, importType, importFrom, Position_1.LineColPosition.buildFromNode(importTypeNode, this.sourceFile), 0);
        importInfo.setDeclaringArkFile(this.declaringMethod.getDeclaringArkFile());
        return new Expr_1.AliasTypeExpr(importInfo, importTypeNode.isTypeOf);
    }
    switchStatementToValueAndStmts(switchStatement) {
        const valueAndStmtsOfSwitchAndCases = [];
        const exprStmts = [];
        let { value: exprValue, valueOriginalPositions: exprPositions, stmts: exprTempStmts } = this.tsNodeToValueAndStmts(switchStatement.expression);
        exprTempStmts.forEach(stmt => exprStmts.push(stmt));
        if (IRUtils_1.IRUtils.moreThanOneAddress(exprValue)) {
            ({ value: exprValue, valueOriginalPositions: exprPositions, stmts: exprTempStmts } = this.generateAssignStmtForValue(exprValue, exprPositions));
            exprTempStmts.forEach(stmt => exprStmts.push(stmt));
        }
        valueAndStmtsOfSwitchAndCases.push({
            value: exprValue,
            valueOriginalPositions: exprPositions,
            stmts: exprStmts,
        });
        for (const clause of switchStatement.caseBlock.clauses) {
            if (ts.isCaseClause(clause)) {
                const clauseStmts = [];
                let { value: clauseValue, valueOriginalPositions: clausePositions, stmts: clauseTempStmts } = this.tsNodeToValueAndStmts(clause.expression);
                clauseTempStmts.forEach(stmt => clauseStmts.push(stmt));
                if (IRUtils_1.IRUtils.moreThanOneAddress(clauseValue)) {
                    ({
                        value: clauseValue,
                        valueOriginalPositions: clausePositions,
                        stmts: clauseTempStmts,
                    } = this.generateAssignStmtForValue(clauseValue, clausePositions));
                    clauseTempStmts.forEach(stmt => clauseStmts.push(stmt));
                }
                valueAndStmtsOfSwitchAndCases.push({
                    value: clauseValue,
                    valueOriginalPositions: clausePositions,
                    stmts: clauseStmts,
                });
            }
        }
        return valueAndStmtsOfSwitchAndCases;
    }
    forStatementToStmts(forStatement) {
        const stmts = [];
        if (forStatement.initializer) {
            this.tsNodeToValueAndStmts(forStatement.initializer).stmts.forEach(stmt => stmts.push(stmt));
        }
        const dummyInitializerStmt = new DummyStmt(ArkIRTransformer.DUMMY_LOOP_INITIALIZER_STMT);
        stmts.push(dummyInitializerStmt);
        if (forStatement.condition) {
            const { value: conditionValue, stmts: conditionStmts } = this.arkValueTransformer.conditionToValueAndStmts(forStatement.condition);
            conditionStmts.forEach(stmt => stmts.push(stmt));
            stmts.push(new Stmt_1.ArkIfStmt(conditionValue));
        }
        else {
            // The omitted condition always evaluates to true.
            const trueConstant = ValueUtil_1.ValueUtil.getBooleanConstant(true);
            const conditionExpr = new Expr_1.ArkConditionExpr(trueConstant, trueConstant, Expr_1.RelationalBinaryOperator.Equality);
            stmts.push(new Stmt_1.ArkIfStmt(conditionExpr));
        }
        if (forStatement.incrementor) {
            this.tsNodeToValueAndStmts(forStatement.incrementor).stmts.forEach(stmt => stmts.push(stmt));
        }
        return stmts;
    }
    rangeForStatementToStmts(forOfStatement) {
        const stmts = [];
        let { value: iterableValue, valueOriginalPositions: iterablePositions, stmts: iterableStmts } = this.tsNodeToValueAndStmts(forOfStatement.expression);
        iterableStmts.forEach(stmt => stmts.push(stmt));
        if (!(iterableValue instanceof Local_1.Local)) {
            ({
                value: iterableValue,
                valueOriginalPositions: iterablePositions,
                stmts: iterableStmts,
            } = this.generateAssignStmtForValue(iterableValue, iterablePositions));
            iterableStmts.forEach(stmt => stmts.push(stmt));
        }
        const iteratorMethodSubSignature = new ArkSignature_1.MethodSubSignature(Builtin_1.Builtin.ITERATOR_FUNCTION, [], Builtin_1.Builtin.ITERATOR_CLASS_TYPE);
        const iteratorMethodSignature = new ArkSignature_1.MethodSignature(ArkSignature_1.ClassSignature.DEFAULT, iteratorMethodSubSignature);
        const iteratorInvokeExpr = new Expr_1.ArkInstanceInvokeExpr(iterableValue, iteratorMethodSignature, []);
        const iteratorInvokeExprPositions = [iterablePositions[0], ...iterablePositions];
        const { value: iterator, valueOriginalPositions: iteratorPositions, stmts: iteratorStmts, } = this.generateAssignStmtForValue(iteratorInvokeExpr, iteratorInvokeExprPositions);
        iteratorStmts.forEach(stmt => stmts.push(stmt));
        iterator.setType(Builtin_1.Builtin.ITERATOR_CLASS_TYPE);
        const nextMethodSubSignature = new ArkSignature_1.MethodSubSignature(Builtin_1.Builtin.ITERATOR_NEXT, [], Builtin_1.Builtin.ITERATOR_RESULT_CLASS_TYPE);
        const nextMethodSignature = new ArkSignature_1.MethodSignature(ArkSignature_1.ClassSignature.DEFAULT, nextMethodSubSignature);
        const iteratorNextInvokeExpr = new Expr_1.ArkInstanceInvokeExpr(iterator, nextMethodSignature, []);
        const iteratorNextInvokeExprPositions = [iteratorPositions[0], ...iteratorPositions];
        const { value: iteratorResult, valueOriginalPositions: iteratorResultPositions, stmts: iteratorResultStmts, } = this.generateAssignStmtForValue(iteratorNextInvokeExpr, iteratorNextInvokeExprPositions);
        iteratorResultStmts.forEach(stmt => stmts.push(stmt));
        iteratorResult.setType(Builtin_1.Builtin.ITERATOR_RESULT_CLASS_TYPE);
        const doneFieldSignature = new ArkSignature_1.FieldSignature(Builtin_1.Builtin.ITERATOR_RESULT_DONE, Builtin_1.Builtin.ITERATOR_RESULT_CLASS_SIGNATURE, Type_1.BooleanType.getInstance(), false);
        const doneFieldRef = new Ref_1.ArkInstanceFieldRef(iteratorResult, doneFieldSignature);
        const doneFieldRefPositions = [iteratorResultPositions[0], ...iteratorResultPositions];
        const { value: doneFlag, valueOriginalPositions: doneFlagPositions, stmts: doneFlagStmts, } = this.generateAssignStmtForValue(doneFieldRef, doneFieldRefPositions);
        doneFlagStmts.forEach(stmt => stmts.push(stmt));
        doneFlag.setType(Type_1.BooleanType.getInstance());
        const conditionExpr = new Expr_1.ArkConditionExpr(doneFlag, ValueUtil_1.ValueUtil.getBooleanConstant(true), Expr_1.RelationalBinaryOperator.InEquality);
        const conditionExprPositions = [doneFlagPositions[0], ...doneFlagPositions, Position_1.FullPosition.DEFAULT];
        const ifStmt = new Stmt_1.ArkIfStmt(conditionExpr);
        ifStmt.setOperandOriginalPositions(conditionExprPositions);
        stmts.push(ifStmt);
        const valueFieldSignature = new ArkSignature_1.FieldSignature(Builtin_1.Builtin.ITERATOR_RESULT_VALUE, Builtin_1.Builtin.ITERATOR_RESULT_CLASS_SIGNATURE, Type_1.UnknownType.getInstance(), false);
        const valueFieldRef = new Ref_1.ArkInstanceFieldRef(iteratorResult, valueFieldSignature);
        const valueFieldRefPositions = [iteratorResultPositions[0], ...iteratorResultPositions];
        const { value: yieldValue, valueOriginalPositions: yieldValuePositions, stmts: yieldValueStmts, } = this.generateAssignStmtForValue(valueFieldRef, valueFieldRefPositions);
        yieldValueStmts.forEach(stmt => stmts.push(stmt));
        const castExpr = new Expr_1.ArkCastExpr(yieldValue, Type_1.UnknownType.getInstance());
        const castExprPositions = [yieldValuePositions[0], ...yieldValuePositions];
        const initializerNode = forOfStatement.initializer;
        if (ts.isVariableDeclarationList(initializerNode)) {
            const isConst = (initializerNode.flags & ts.NodeFlags.Const) !== 0;
            const { value: initValue, valueOriginalPositions: initOriPos, stmts: initStmts, } = this.arkValueTransformer.variableDeclarationToValueAndStmts(initializerNode.declarations[0], isConst, false);
            const assignStmt = new Stmt_1.ArkAssignStmt(initValue, castExpr);
            assignStmt.setOperandOriginalPositions([...initOriPos, ...castExprPositions]);
            stmts.push(assignStmt);
            initStmts.forEach(stmt => stmts.push(stmt));
        }
        else {
            // initializer maybe an expression
            const { value: initValue, valueOriginalPositions: initOriPos, stmts: initStmts } = this.tsNodeToValueAndStmts(initializerNode);
            const assignStmt = new Stmt_1.ArkAssignStmt(initValue, castExpr);
            assignStmt.setOperandOriginalPositions([...initOriPos, ...castExprPositions]);
            initStmts.forEach(stmt => stmts.push(stmt));
            stmts.push(assignStmt);
        }
        return stmts;
    }
    whileStatementToStmts(whileStatement) {
        const stmts = [];
        const dummyInitializerStmt = new DummyStmt(ArkIRTransformer.DUMMY_LOOP_INITIALIZER_STMT);
        stmts.push(dummyInitializerStmt);
        const { value: conditionExpr, stmts: conditionStmts } = this.arkValueTransformer.conditionToValueAndStmts(whileStatement.expression);
        conditionStmts.forEach(stmt => stmts.push(stmt));
        stmts.push(new Stmt_1.ArkIfStmt(conditionExpr));
        return stmts;
    }
    doStatementToStmts(doStatement) {
        const stmts = [];
        const { value: conditionExpr, stmts: conditionStmts } = this.arkValueTransformer.conditionToValueAndStmts(doStatement.expression);
        conditionStmts.forEach(stmt => stmts.push(stmt));
        stmts.push(new Stmt_1.ArkIfStmt(conditionExpr));
        return stmts;
    }
    variableStatementToStmts(variableStatement) {
        return this.variableDeclarationListToStmts(variableStatement.declarationList);
    }
    variableDeclarationListToStmts(variableDeclarationList) {
        return this.arkValueTransformer.variableDeclarationListToValueAndStmts(variableDeclarationList).stmts;
    }
    ifStatementToStmts(ifStatement) {
        const stmts = [];
        if (this.inBuilderMethod) {
            const { value: conditionExpr, valueOriginalPositions: conditionExprPositions, stmts: conditionStmts, } = this.arkValueTransformer.conditionToValueAndStmts(ifStatement.expression);
            conditionStmts.forEach(stmt => stmts.push(stmt));
            const createMethodSignature = ArkSignatureBuilder_1.ArkSignatureBuilder.buildMethodSignatureFromClassNameAndMethodName(EtsConst_1.COMPONENT_IF, EtsConst_1.COMPONENT_CREATE_FUNCTION);
            const { value: conditionLocal, valueOriginalPositions: conditionLocalPositions, stmts: assignConditionStmts, } = this.generateAssignStmtForValue(conditionExpr, conditionExprPositions);
            assignConditionStmts.forEach(stmt => stmts.push(stmt));
            const createInvokeExpr = new Expr_1.ArkStaticInvokeExpr(createMethodSignature, [conditionLocal]);
            const createInvokeExprPositions = [conditionLocalPositions[0], ...conditionLocalPositions];
            const { stmts: createStmts } = this.generateAssignStmtForValue(createInvokeExpr, createInvokeExprPositions);
            createStmts.forEach(stmt => stmts.push(stmt));
            const branchMethodSignature = ArkSignatureBuilder_1.ArkSignatureBuilder.buildMethodSignatureFromClassNameAndMethodName(EtsConst_1.COMPONENT_IF, EtsConst_1.COMPONENT_BRANCH_FUNCTION);
            const branchInvokeExpr = new Expr_1.ArkStaticInvokeExpr(branchMethodSignature, [ValueUtil_1.ValueUtil.getOrCreateNumberConst(0)]);
            const branchInvokeExprPositions = [conditionLocalPositions[0], Position_1.FullPosition.DEFAULT];
            const branchInvokeStmt = new Stmt_1.ArkInvokeStmt(branchInvokeExpr);
            branchInvokeStmt.setOperandOriginalPositions(branchInvokeExprPositions);
            stmts.push(branchInvokeStmt);
            this.tsNodeToStmts(ifStatement.thenStatement).forEach(stmt => stmts.push(stmt));
            if (ifStatement.elseStatement) {
                const branchElseMethodSignature = ArkSignatureBuilder_1.ArkSignatureBuilder.buildMethodSignatureFromClassNameAndMethodName(EtsConst_1.COMPONENT_IF, EtsConst_1.COMPONENT_BRANCH_FUNCTION);
                const branchElseInvokeExpr = new Expr_1.ArkStaticInvokeExpr(branchElseMethodSignature, [ValueUtil_1.ValueUtil.getOrCreateNumberConst(1)]);
                const branchElseInvokeExprPositions = [Position_1.FullPosition.buildFromNode(ifStatement.elseStatement, this.sourceFile), Position_1.FullPosition.DEFAULT];
                const branchElseInvokeStmt = new Stmt_1.ArkInvokeStmt(branchElseInvokeExpr);
                branchElseInvokeStmt.setOperandOriginalPositions(branchElseInvokeExprPositions);
                stmts.push(branchElseInvokeStmt);
                this.tsNodeToStmts(ifStatement.elseStatement).forEach(stmt => stmts.push(stmt));
            }
            const popMethodSignature = ArkSignatureBuilder_1.ArkSignatureBuilder.buildMethodSignatureFromClassNameAndMethodName(EtsConst_1.COMPONENT_IF, EtsConst_1.COMPONENT_POP_FUNCTION);
            const popInvokeExpr = new Expr_1.ArkStaticInvokeExpr(popMethodSignature, []);
            const popInvokeStmt = new Stmt_1.ArkInvokeStmt(popInvokeExpr);
            stmts.push(popInvokeStmt);
        }
        else {
            const { value: conditionExpr, valueOriginalPositions: conditionExprPositions, stmts: conditionStmts, } = this.arkValueTransformer.conditionToValueAndStmts(ifStatement.expression);
            conditionStmts.forEach(stmt => stmts.push(stmt));
            const ifStmt = new Stmt_1.ArkIfStmt(conditionExpr);
            ifStmt.setOperandOriginalPositions(conditionExprPositions);
            stmts.push(ifStmt);
        }
        return stmts;
    }
    gotoStatementToStmts(gotoStatement) {
        return [];
    }
    throwStatementToStmts(throwStatement) {
        const stmts = [];
        const { value: throwValue, valueOriginalPositions: throwValuePositions, stmts: throwStmts } = this.tsNodeToValueAndStmts(throwStatement.expression);
        throwStmts.forEach(stmt => stmts.push(stmt));
        const throwStmt = new Stmt_1.ArkThrowStmt(throwValue);
        throwStmt.setOperandOriginalPositions(throwValuePositions);
        stmts.push(throwStmt);
        return stmts;
    }
    catchClauseToStmts(catchClause) {
        const stmts = [];
        if (catchClause.variableDeclaration) {
            const { value: catchValue, valueOriginalPositions: catchOriPos, stmts: catchStmts, } = this.arkValueTransformer.variableDeclarationToValueAndStmts(catchClause.variableDeclaration, false, false);
            const caughtExceptionRef = new Ref_1.ArkCaughtExceptionRef(Type_1.UnknownType.getInstance());
            const assignStmt = new Stmt_1.ArkAssignStmt(catchValue, caughtExceptionRef);
            assignStmt.setOperandOriginalPositions(catchOriPos);
            stmts.push(assignStmt);
            catchStmts.forEach(stmt => stmts.push(stmt));
        }
        return stmts;
    }
    expressionInExportToStmts(expression) {
        if (ts.isNewExpression(expression) || ts.isObjectLiteralExpression(expression)) {
            return this.newClassInExportToStmts(expression);
        }
        return [];
    }
    newClassInExportToStmts(expression) {
        let stmts = [];
        let { value: rightValue, valueOriginalPositions: rightPositions, stmts: rightStmts } = this.tsNodeToValueAndStmts(expression);
        rightStmts.forEach(stmt => stmts.push(stmt));
        let leftValue = this.arkValueTransformer.addNewLocal(TSConst_1.DEFAULT);
        let leftPositions = rightPositions;
        const assignStmt = new Stmt_1.ArkAssignStmt(leftValue, rightValue);
        assignStmt.setOperandOriginalPositions([...leftPositions, ...rightPositions]);
        stmts.push(assignStmt);
        return stmts;
    }
    mapStmtsToTsStmt(stmts, node) {
        for (const stmt of stmts) {
            if (!this.stmtsHaveOriginalText.has(stmt)) {
                this.stmtsHaveOriginalText.add(stmt);
                stmt.setOriginPositionInfo(Position_1.LineColPosition.buildFromNode(node, this.sourceFile));
                stmt.setOriginalText(node.getText(this.sourceFile));
            }
        }
    }
    static tokenToUnaryOperator(token) {
        switch (token) {
            case ts.SyntaxKind.MinusToken:
                return Expr_1.UnaryOperator.Neg;
            case ts.SyntaxKind.TildeToken:
                return Expr_1.UnaryOperator.BitwiseNot;
            case ts.SyntaxKind.ExclamationToken:
                return Expr_1.UnaryOperator.LogicalNot;
            default:
        }
        return null;
    }
    static tokenToBinaryOperator(token) {
        switch (token) {
            case ts.SyntaxKind.QuestionQuestionToken:
                return Expr_1.NormalBinaryOperator.NullishCoalescing;
            case ts.SyntaxKind.AsteriskAsteriskToken:
                return Expr_1.NormalBinaryOperator.Exponentiation;
            case ts.SyntaxKind.SlashToken:
                return Expr_1.NormalBinaryOperator.Division;
            case ts.SyntaxKind.PlusToken:
                return Expr_1.NormalBinaryOperator.Addition;
            case ts.SyntaxKind.MinusToken:
                return Expr_1.NormalBinaryOperator.Subtraction;
            case ts.SyntaxKind.AsteriskToken:
                return Expr_1.NormalBinaryOperator.Multiplication;
            case ts.SyntaxKind.PercentToken:
                return Expr_1.NormalBinaryOperator.Remainder;
            case ts.SyntaxKind.LessThanLessThanToken:
                return Expr_1.NormalBinaryOperator.LeftShift;
            case ts.SyntaxKind.GreaterThanGreaterThanToken:
                return Expr_1.NormalBinaryOperator.RightShift;
            case ts.SyntaxKind.GreaterThanGreaterThanGreaterThanToken:
                return Expr_1.NormalBinaryOperator.UnsignedRightShift;
            case ts.SyntaxKind.AmpersandToken:
                return Expr_1.NormalBinaryOperator.BitwiseAnd;
            case ts.SyntaxKind.BarToken:
                return Expr_1.NormalBinaryOperator.BitwiseOr;
            case ts.SyntaxKind.CaretToken:
                return Expr_1.NormalBinaryOperator.BitwiseXor;
            case ts.SyntaxKind.AmpersandAmpersandToken:
                return Expr_1.NormalBinaryOperator.LogicalAnd;
            case ts.SyntaxKind.BarBarToken:
                return Expr_1.NormalBinaryOperator.LogicalOr;
            case ts.SyntaxKind.LessThanToken:
                return Expr_1.RelationalBinaryOperator.LessThan;
            case ts.SyntaxKind.LessThanEqualsToken:
                return Expr_1.RelationalBinaryOperator.LessThanOrEqual;
            case ts.SyntaxKind.GreaterThanToken:
                return Expr_1.RelationalBinaryOperator.GreaterThan;
            case ts.SyntaxKind.GreaterThanEqualsToken:
                return Expr_1.RelationalBinaryOperator.GreaterThanOrEqual;
            case ts.SyntaxKind.EqualsEqualsToken:
                return Expr_1.RelationalBinaryOperator.Equality;
            case ts.SyntaxKind.ExclamationEqualsToken:
                return Expr_1.RelationalBinaryOperator.InEquality;
            case ts.SyntaxKind.EqualsEqualsEqualsToken:
                return Expr_1.RelationalBinaryOperator.StrictEquality;
            case ts.SyntaxKind.ExclamationEqualsEqualsToken:
                return Expr_1.RelationalBinaryOperator.StrictInequality;
            default:
        }
        return null;
    }
    generateAssignStmtForValue(value, valueOriginalPositions) {
        const leftOp = this.arkValueTransformer.generateTempLocal(value.getType());
        if (valueOriginalPositions.length === 0) {
            return {
                value: leftOp,
                valueOriginalPositions: [],
                stmts: []
            };
        }
        const leftOpPosition = valueOriginalPositions[0];
        const assignStmt = new Stmt_1.ArkAssignStmt(leftOp, value);
        assignStmt.setOperandOriginalPositions([leftOpPosition, ...valueOriginalPositions]);
        return {
            value: leftOp,
            valueOriginalPositions: [leftOpPosition],
            stmts: [assignStmt],
        };
    }
    generateIfStmtForValues(leftValue, leftOpOriginalPositions, rightValue, rightOpOriginalPositions) {
        const stmts = [];
        if (IRUtils_1.IRUtils.moreThanOneAddress(leftValue)) {
            const { value: tempLeftValue, valueOriginalPositions: tempLeftPositions, stmts: leftStmts, } = this.generateAssignStmtForValue(leftValue, leftOpOriginalPositions);
            leftStmts.forEach(stmt => stmts.push(stmt));
            leftValue = tempLeftValue;
            leftOpOriginalPositions = tempLeftPositions;
        }
        if (IRUtils_1.IRUtils.moreThanOneAddress(rightValue)) {
            const { value: tempRightValue, valueOriginalPositions: tempRightPositions, stmts: rightStmts, } = this.generateAssignStmtForValue(rightValue, rightOpOriginalPositions);
            rightStmts.forEach(stmt => stmts.push(stmt));
            rightValue = tempRightValue;
            rightOpOriginalPositions = tempRightPositions;
        }
        const conditionExpr = new Expr_1.ArkConditionExpr(leftValue, rightValue, Expr_1.RelationalBinaryOperator.Equality);
        const conditionPositions = [...leftOpOriginalPositions, ...rightOpOriginalPositions];
        const ifStmt = new Stmt_1.ArkIfStmt(conditionExpr);
        ifStmt.setOperandOriginalPositions([...conditionPositions]);
        stmts.push(ifStmt);
        return stmts;
    }
    setBuilderMethodContextFlag(builderMethodContextFlag) {
        this.builderMethodContextFlag = builderMethodContextFlag;
    }
}
exports.ArkIRTransformer = ArkIRTransformer;
ArkIRTransformer.DUMMY_LOOP_INITIALIZER_STMT = 'LoopInitializer';
ArkIRTransformer.DUMMY_CONDITIONAL_OPERATOR = 'ConditionalOperator';
ArkIRTransformer.DUMMY_CONDITIONAL_OPERATOR_IF_TRUE_STMT = ArkIRTransformer.DUMMY_CONDITIONAL_OPERATOR + 'IfTrue';
ArkIRTransformer.DUMMY_CONDITIONAL_OPERATOR_IF_FALSE_STMT = ArkIRTransformer.DUMMY_CONDITIONAL_OPERATOR + 'IfFalse';
ArkIRTransformer.DUMMY_CONDITIONAL_OPERATOR_END_STMT = ArkIRTransformer.DUMMY_CONDITIONAL_OPERATOR + 'End';
//# sourceMappingURL=ArkIRTransformer.js.map