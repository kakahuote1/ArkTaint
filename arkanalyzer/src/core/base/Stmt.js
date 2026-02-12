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
exports.ArkAliasTypeDefineStmt = exports.ArkThrowStmt = exports.ArkReturnVoidStmt = exports.ArkReturnStmt = exports.ArkIfStmt = exports.ArkInvokeStmt = exports.ArkAssignStmt = exports.Stmt = void 0;
const StmtUseReplacer_1 = require("../common/StmtUseReplacer");
const Expr_1 = require("./Expr");
const Ref_1 = require("./Ref");
const Position_1 = require("./Position");
const ArkMetadata_1 = require("../model/ArkMetadata");
const StmtDefReplacer_1 = require("../common/StmtDefReplacer");
const IRUtils_1 = require("../common/IRUtils");
const Type_1 = require("./Type");
const ArkBaseModel_1 = require("../model/ArkBaseModel");
const TypeExpr_1 = require("./TypeExpr");
/**
 * @category core/base/stmt
 */
class Stmt {
    constructor() {
        this.originalPosition = Position_1.LineColPosition.DEFAULT;
    }
    getMetadata(kind) {
        return this.metadata?.getMetadata(kind);
    }
    setMetadata(kind, value) {
        if (!this.metadata) {
            this.metadata = new ArkMetadata_1.ArkMetadata();
        }
        return this.metadata?.setMetadata(kind, value);
    }
    /** Return a list of values which are uesd in this statement */
    getUses() {
        return [];
    }
    replaceUse(oldUse, newUse) {
        const stmtUseReplacer = new StmtUseReplacer_1.StmtUseReplacer(oldUse, newUse);
        stmtUseReplacer.caseStmt(this);
    }
    /**
     * Return the definition which is uesd in this statement. Generally, the definition is the left value of `=` in
     * 3AC.  For example, the definition in 3AC of `value = parameter0: @project-1/sample-1.ets: AnonymousClass-0` is
     * `value`,  and the definition in `$temp0 = staticinvoke <@_ProjectName/_FileName: xxx.create()>()` is `\$temp0`.
     * @returns The definition in 3AC (may be a **null**).
     * @example
     * 1. get the def in stmt.
     ```typescript
     for (const block of this.blocks) {
     for (const stmt of block.getStmts()) {
     const defValue = stmt.getDef();
     ...
     }
     }
     ```
     */
    getDef() {
        return null;
    }
    replaceDef(oldDef, newDef) {
        const stmtDefReplacer = new StmtDefReplacer_1.StmtDefReplacer(oldDef, newDef);
        stmtDefReplacer.caseStmt(this);
    }
    getDefAndUses() {
        const defAndUses = [];
        const def = this.getDef();
        if (def) {
            defAndUses.push(def);
        }
        defAndUses.push(...this.getUses());
        return defAndUses;
    }
    /**
     * Get the CFG (i.e., control flow graph) of an {@link ArkBody} in which the statement is.
     * A CFG contains a set of basic blocks and statements corresponding to each basic block.
     * Note that, "source code" and "three-address" are two types of {@link Stmt} in ArkAnalyzer.
     * Source code {@link Stmt} represents the statement of ets/ts source code, while three-address code {@link Stmt}
     * represents the statement after it has been converted into three-address code.  Since the source code {@link
     * Stmt} does not save its CFG reference, it returns **null**, while the `getCfg()` of the third address code
     * {@link Stmt} will return its CFG reference.
     * @returns The CFG (i.e., control flow graph) of an {@link ArkBody} in which the statement is.
     * @example
     * 1. get the ArkFile based on stmt.
     ```typescript
     const arkFile = stmt.getCfg()?.getDeclaringMethod().getDeclaringArkFile();
     ```
     2. get the ArkMethod based on stmt.
     ```typescript
     let sourceMethod: ArkMethod = stmt.getCfg()?.getDeclaringMethod();
     ```
     */
    getCfg() {
        return this.cfg;
    }
    setCfg(cfg) {
        this.cfg = cfg;
    }
    /**
     * Return true if the following statement may not execute after this statement.
     * The ArkIfStmt and ArkGotoStmt will return true.
     */
    isBranch() {
        return false;
    }
    /** Return the number of statements which this statement may go to */
    getExpectedSuccessorCount() {
        return 1;
    }
    containsInvokeExpr() {
        for (const use of this.getUses()) {
            if (use instanceof Expr_1.AbstractInvokeExpr) {
                return true;
            }
        }
        return false;
    }
    /**
     * Returns the method's invocation expression (including method signature and its arguments)
     * in the current statement. An **undefined** will be returned if there is no method used in this statement.
     * @returns  the method's invocation expression from the statement. An **undefined** will be returned if there is
     *     no method can be found in this statement.
     * @example
     * 1. get invoke expr based on stmt.
     ```typescript
     let invoke = stmt.getInvokeExpr();
     ```
     */
    getInvokeExpr() {
        for (const use of this.getUses()) {
            if (use instanceof Expr_1.AbstractInvokeExpr) {
                return use;
            }
        }
        return undefined;
    }
    /**
     * Returns an array of expressions in the statement.
     * @returns An array of expressions in the statement.
     * @example
     * 1. Traverse expression of statement.

     ```typescript
     for (const expr of stmt.getExprs()) {
     ...
     }
     ```
     */
    getExprs() {
        let exprs = [];
        for (const use of this.getUses()) {
            if (use instanceof Expr_1.AbstractExpr) {
                exprs.push(use);
            }
        }
        return exprs;
    }
    getTypeExprs() {
        let typeExprs = [];
        for (const value of this.getDefAndUses()) {
            const valueType = value.getType();
            if (valueType instanceof TypeExpr_1.AbstractTypeExpr) {
                typeExprs.push(valueType);
            }
        }
        return typeExprs;
    }
    containsArrayRef() {
        for (const use of this.getUses()) {
            if (use instanceof Ref_1.ArkArrayRef) {
                return true;
            }
        }
        if (this.getDef() instanceof Ref_1.ArkArrayRef) {
            return true;
        }
        return false;
    }
    getArrayRef() {
        for (const use of this.getUses()) {
            if (use instanceof Ref_1.ArkArrayRef) {
                return use;
            }
        }
        if (this.getDef() instanceof Ref_1.ArkArrayRef) {
            return undefined;
        }
        return undefined;
    }
    containsFieldRef() {
        for (const use of this.getUses()) {
            if (use instanceof Ref_1.AbstractFieldRef) {
                return true;
            }
        }
        if (this.getDef() instanceof Ref_1.AbstractFieldRef) {
            return true;
        }
        return false;
    }
    getFieldRef() {
        for (const use of this.getUses()) {
            if (use instanceof Ref_1.AbstractFieldRef) {
                return use;
            }
        }
        if (this.getDef() instanceof Ref_1.AbstractFieldRef) {
            return undefined;
        }
        return undefined;
    }
    setOriginPositionInfo(originPositionInfo) {
        this.originalPosition = originPositionInfo;
    }
    /**
     * Returns the original position of the statement.
     * The position consists of two parts: line number and column number.
     * In the source file, the former (i.e., line number) indicates which line the statement is in,
     * and the latter (i.e., column number) indicates the position of the statement in the line.
     * The position is described as `LineColPosition(lineNo,colNum)` in ArkAnalyzer,
     * and its default value is LineColPosition(-1,-1).
     * @returns The original location of the statement.
     * @example
     * 1. Get the stmt position info to make some condition judgements.
     ```typescript
     for (const stmt of stmts) {
     if (stmt.getOriginPositionInfo().getLineNo() === -1) {
     stmt.setOriginPositionInfo(originalStmt.getOriginPositionInfo());
     this.stmtToOriginalStmt.set(stmt, originalStmt);
     }
     }
     ```
     */
    getOriginPositionInfo() {
        return this.originalPosition;
    }
    setText(text) {
        this.text = text;
    }
    setOriginalText(originalText) {
        this.originalText = originalText;
    }
    getOriginalText() {
        return this.originalText;
    }
    setOperandOriginalPositions(operandOriginalPositions) {
        this.operandOriginalPositions = operandOriginalPositions;
    }
    getOperandOriginalPositions() {
        return this.operandOriginalPositions;
    }
    getOperandOriginalPosition(indexOrOperand) {
        let index = -1;
        if (typeof indexOrOperand !== 'number') {
            index = IRUtils_1.IRUtils.findOperandIdx(this, indexOrOperand);
        }
        else {
            index = indexOrOperand;
        }
        if (!this.operandOriginalPositions || index < 0 || index > this.operandOriginalPositions.length) {
            return null;
        }
        return this.operandOriginalPositions[index];
    }
}
exports.Stmt = Stmt;
class ArkAssignStmt extends Stmt {
    constructor(leftOp, rightOp) {
        super();
        this.leftOp = leftOp;
        this.rightOp = rightOp;
    }
    /**
     * Returns the left operand of the assigning statement.
     * @returns The left operand of the assigning statement.
     * @example
     * 1. If the statement is `a=b;`, the right operand is `a`; if the statement is `dd = cc + 5;`, the right operand
     *     is `cc`.
     */
    getLeftOp() {
        return this.leftOp;
    }
    setLeftOp(newLeftOp) {
        this.leftOp = newLeftOp;
    }
    /**
     * Returns the right operand of the assigning statement.
     * @returns The right operand of the assigning statement.
     * @example
     * 1. If the statement is `a=b;`, the right operand is `b`; if the statement is `dd = cc + 5;`, the right operand
     *     is `cc + 5`.
     * 2. Get the rightOp from stmt.
     ```typescript
     const rightOp = stmt.getRightOp();
     ```
     */
    getRightOp() {
        return this.rightOp;
    }
    setRightOp(rightOp) {
        this.rightOp = rightOp;
    }
    toString() {
        const str = this.getLeftOp() + ' = ' + this.getRightOp();
        return str;
    }
    getDef() {
        return this.leftOp;
    }
    getUses() {
        let uses = [];
        uses.push(...this.leftOp.getUses());
        uses.push(this.rightOp);
        uses.push(...this.rightOp.getUses());
        return uses;
    }
}
exports.ArkAssignStmt = ArkAssignStmt;
class ArkInvokeStmt extends Stmt {
    constructor(invokeExpr) {
        super();
        this.invokeExpr = invokeExpr;
    }
    replaceInvokeExpr(newExpr) {
        this.invokeExpr = newExpr;
    }
    getInvokeExpr() {
        return this.invokeExpr;
    }
    toString() {
        const str = this.invokeExpr.toString();
        return str;
    }
    getUses() {
        let uses = [];
        uses.push(this.invokeExpr);
        uses.push(...this.invokeExpr.getUses());
        return uses;
    }
}
exports.ArkInvokeStmt = ArkInvokeStmt;
class ArkIfStmt extends Stmt {
    constructor(conditionExpr) {
        super();
        this.conditionExpr = conditionExpr;
    }
    /**
     * The condition expression consisit of two values as operands and one binary operator as operator.
     * The operator can indicate the relation between the two values, e.g., `<`, `<=`,`>`, `>=`, `==`, `!=`, `===`,
     * `!==`.
     * @returns a condition expression.
     * @example
     * 1. When a statement is `if (a > b)`, the operands are `a` and `b`, the operator is `<`. Therefore, the condition
     *     expression is `a > b`.
     * 2. get a conditon expr from a condition statement.
     ```typescript
     let expr = (this.original as ArkIfStmt).getConditionExpr();
     ```
     */
    getConditionExpr() {
        return this.conditionExpr;
    }
    setConditionExpr(newConditionExpr) {
        this.conditionExpr = newConditionExpr;
    }
    isBranch() {
        return true;
    }
    getExpectedSuccessorCount() {
        return 2;
    }
    toString() {
        const str = 'if ' + this.conditionExpr;
        return str;
    }
    getUses() {
        let uses = [];
        uses.push(this.conditionExpr);
        uses.push(...this.conditionExpr.getUses());
        return uses;
    }
}
exports.ArkIfStmt = ArkIfStmt;
class ArkReturnStmt extends Stmt {
    constructor(op) {
        super();
        this.op = op;
    }
    getExpectedSuccessorCount() {
        return 0;
    }
    getOp() {
        return this.op;
    }
    setReturnValue(returnValue) {
        this.op = returnValue;
    }
    toString() {
        const str = 'return ' + this.op;
        return str;
    }
    getUses() {
        let uses = [];
        uses.push(this.op);
        uses.push(...this.op.getUses());
        return uses;
    }
}
exports.ArkReturnStmt = ArkReturnStmt;
class ArkReturnVoidStmt extends Stmt {
    constructor() {
        super();
    }
    getExpectedSuccessorCount() {
        return 0;
    }
    toString() {
        const str = 'return';
        return str;
    }
}
exports.ArkReturnVoidStmt = ArkReturnVoidStmt;
class ArkThrowStmt extends Stmt {
    constructor(op) {
        super();
        this.op = op;
    }
    getOp() {
        return this.op;
    }
    setOp(newOp) {
        this.op = newOp;
    }
    toString() {
        const str = 'throw ' + this.op;
        return str;
    }
    getUses() {
        let uses = [];
        uses.push(this.op);
        uses.push(...this.op.getUses());
        return uses;
    }
}
exports.ArkThrowStmt = ArkThrowStmt;
/**
 * Statement of type alias definition combines with the left hand as {@link AliasType} and right hand as {@link AliasTypeExpr}.
 * @category core/base/stmt
 * @extends Stmt
 * @example
 ```typescript
 type A = string;
 type B = import('./abc').TypeB;

 let c = 123;
 declare type C = typeof c;
 ```
 */
class ArkAliasTypeDefineStmt extends Stmt {
    constructor(aliasType, typeAliasExpr) {
        super();
        this.aliasType = aliasType;
        this.aliasTypeExpr = typeAliasExpr;
    }
    getAliasType() {
        return this.aliasType;
    }
    getAliasTypeExpr() {
        return this.aliasTypeExpr;
    }
    getAliasName() {
        return this.getAliasType().getName();
    }
    toString() {
        let str = `type ${this.getAliasType().toString()} = ${this.getAliasTypeExpr().toString()}`;
        if (this.getAliasType().containsModifier(ArkBaseModel_1.ModifierType.DECLARE)) {
            str = 'declare ' + str;
        }
        if (this.getAliasType().containsModifier(ArkBaseModel_1.ModifierType.EXPORT)) {
            str = 'export ' + str;
        }
        return str;
    }
    getUses() {
        const values = [];
        this.getTypeExprs().forEach(e => e.getUses().forEach(use => values.push(use)));
        values.push(this.aliasTypeExpr);
        return values;
    }
    getTypeExprs() {
        function getTypeExprsInType(originalObject) {
            let typeExprs = [];
            if (originalObject instanceof TypeExpr_1.AbstractTypeExpr) {
                typeExprs.push(originalObject);
            }
            else if (originalObject instanceof Type_1.ArrayType) {
                typeExprs.push(...getTypeExprsInType(originalObject.getBaseType()));
            }
            else if (originalObject instanceof Type_1.UnionType || originalObject instanceof Type_1.IntersectionType || originalObject instanceof Type_1.TupleType) {
                for (const member of originalObject.getTypes()) {
                    typeExprs.push(...getTypeExprsInType(member));
                }
            }
            return typeExprs;
        }
        const originalObject = this.getAliasTypeExpr().getOriginalObject();
        if (originalObject instanceof Type_1.Type) {
            return getTypeExprsInType(originalObject);
        }
        return [];
    }
}
exports.ArkAliasTypeDefineStmt = ArkAliasTypeDefineStmt;
//# sourceMappingURL=Stmt.js.map