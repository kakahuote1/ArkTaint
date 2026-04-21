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
exports.StmtUseReplacer = void 0;
const Expr_1 = require("../base/Expr");
const Ref_1 = require("../base/Ref");
const Stmt_1 = require("../base/Stmt");
const ExprUseReplacer_1 = require("./ExprUseReplacer");
const RefUseReplacer_1 = require("./RefUseReplacer");
const IRUtils_1 = require("./IRUtils");
/**
 * Replace old use(Value) of a Stmt inplace
 */
class StmtUseReplacer {
    constructor(oldUse, newUse) {
        this.oldUse = oldUse;
        this.newUse = newUse;
    }
    caseStmt(stmt) {
        if (stmt instanceof Stmt_1.ArkAssignStmt) {
            this.caseAssignStmt(stmt);
        }
        else if (stmt instanceof Stmt_1.ArkInvokeStmt) {
            this.caseInvokeStmt(stmt);
        }
        else if (stmt instanceof Stmt_1.ArkReturnStmt) {
            this.caseReturnStmt(stmt);
        }
        else if (stmt instanceof Stmt_1.ArkIfStmt) {
            this.caseIfStmt(stmt);
        }
        else if (stmt instanceof Stmt_1.ArkThrowStmt) {
            this.caseThrowStmt(stmt);
        }
    }
    caseAssignStmt(stmt) {
        const lValue = stmt.getLeftOp();
        if (lValue instanceof Ref_1.AbstractRef) {
            const refUseReplacer = new RefUseReplacer_1.RefUseReplacer(this.oldUse, this.newUse);
            refUseReplacer.caseRef(lValue);
        }
        const rValue = stmt.getRightOp();
        if (rValue === this.oldUse) {
            IRUtils_1.IRUtils.adjustOperandOriginalPositions(stmt, this.oldUse, this.newUse);
            stmt.setRightOp(this.newUse);
        }
        else if (rValue instanceof Ref_1.AbstractRef) {
            const refUseReplacer = new RefUseReplacer_1.RefUseReplacer(this.oldUse, this.newUse);
            refUseReplacer.caseRef(rValue);
        }
        else if (rValue instanceof Expr_1.AbstractExpr) {
            const exprUseReplacer = new ExprUseReplacer_1.ExprUseReplacer(this.oldUse, this.newUse);
            exprUseReplacer.caseExpr(rValue);
        }
    }
    caseInvokeStmt(stmt) {
        const invokeExpr = stmt.getInvokeExpr();
        if (invokeExpr === this.oldUse) {
            if (this.newUse instanceof Expr_1.AbstractInvokeExpr) {
                IRUtils_1.IRUtils.adjustOperandOriginalPositions(stmt, this.oldUse, this.newUse);
                stmt.replaceInvokeExpr(this.newUse);
            }
        }
        else {
            let exprUseReplacer = new ExprUseReplacer_1.ExprUseReplacer(this.oldUse, this.newUse);
            exprUseReplacer.caseExpr(stmt.getInvokeExpr());
        }
    }
    caseReturnStmt(stmt) {
        if (stmt.getOp() === this.oldUse) {
            IRUtils_1.IRUtils.adjustOperandOriginalPositions(stmt, this.oldUse, this.newUse);
            stmt.setReturnValue(this.newUse);
        }
    }
    caseIfStmt(stmt) {
        const conditionExpr = stmt.getConditionExpr();
        if (conditionExpr === this.oldUse) {
            if (this.newUse instanceof Expr_1.ArkConditionExpr) {
                IRUtils_1.IRUtils.adjustOperandOriginalPositions(stmt, this.oldUse, this.newUse);
                stmt.setConditionExpr(this.newUse);
            }
        }
        else {
            let exprUseReplacer = new ExprUseReplacer_1.ExprUseReplacer(this.oldUse, this.newUse);
            exprUseReplacer.caseExpr(stmt.getConditionExpr());
        }
    }
    caseThrowStmt(stmt) {
        if (stmt.getOp() === this.oldUse) {
            IRUtils_1.IRUtils.adjustOperandOriginalPositions(stmt, this.oldUse, this.newUse);
            stmt.setOp(this.newUse);
        }
    }
}
exports.StmtUseReplacer = StmtUseReplacer;
