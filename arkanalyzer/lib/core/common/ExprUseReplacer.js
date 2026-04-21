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
exports.ExprUseReplacer = void 0;
const Expr_1 = require("../base/Expr");
const Local_1 = require("../base/Local");
const Ref_1 = require("../base/Ref");
/**
 * Replace old use of a Expr inplace
 */
class ExprUseReplacer {
    constructor(oldUse, newUse) {
        this.oldUse = oldUse;
        this.newUse = newUse;
    }
    caseExpr(expr) {
        if (expr instanceof Expr_1.AbstractBinopExpr) {
            this.caseBinopExpr(expr);
        }
        else if (expr instanceof Expr_1.AbstractInvokeExpr) {
            this.caseInvokeExpr(expr);
        }
        else if (expr instanceof Expr_1.ArkNewArrayExpr) {
            this.caseNewArrayExpr(expr);
        }
        else if (expr instanceof Expr_1.ArkTypeOfExpr) {
            this.caseTypeOfExpr(expr);
        }
        else if (expr instanceof Expr_1.ArkInstanceOfExpr) {
            this.caseInstanceOfExpr(expr);
        }
        else if (expr instanceof Expr_1.ArkCastExpr) {
            this.caseCastExpr(expr);
        }
        else if (expr instanceof Expr_1.ArkAwaitExpr) {
            this.caseAwaitExpr(expr);
        }
        else if (expr instanceof Expr_1.ArkYieldExpr) {
            this.caseYieldExpr(expr);
        }
        else if (expr instanceof Expr_1.ArkDeleteExpr) {
            this.caseDeleteExpr(expr);
        }
        else if (expr instanceof Expr_1.ArkUnopExpr) {
            this.caseUnopExpr(expr);
        }
    }
    caseBinopExpr(expr) {
        if (expr.getOp1() === this.oldUse) {
            expr.setOp1(this.newUse);
        }
        if (expr.getOp2() === this.oldUse) {
            expr.setOp2(this.newUse);
        }
    }
    caseInvokeExpr(expr) {
        let args = expr.getArgs();
        for (let i = 0; i < args.length; i++) {
            if (args[i] === this.oldUse) {
                args[i] = this.newUse;
            }
        }
        if (expr instanceof Expr_1.ArkInstanceInvokeExpr && expr.getBase() === this.oldUse) {
            expr.setBase(this.newUse);
        }
        else if (expr instanceof Expr_1.ArkPtrInvokeExpr && expr.getFuncPtrLocal() === this.oldUse && this.newUse instanceof Local_1.Local) {
            expr.setFunPtrLocal(this.newUse);
        }
    }
    caseNewArrayExpr(expr) {
        if (expr.getSize() === this.oldUse) {
            expr.setSize(this.newUse);
        }
    }
    caseTypeOfExpr(expr) {
        if (expr.getOp() === this.oldUse) {
            expr.setOp(this.newUse);
        }
    }
    caseInstanceOfExpr(expr) {
        if (expr.getOp() === this.oldUse) {
            expr.setOp(this.newUse);
        }
    }
    caseCastExpr(expr) {
        if (expr.getOp() === this.oldUse) {
            expr.setOp(this.newUse);
        }
    }
    caseAwaitExpr(expr) {
        if (expr.getPromise() === this.oldUse) {
            expr.setPromise(this.newUse);
        }
    }
    caseDeleteExpr(expr) {
        if (expr.getField() === this.oldUse && this.newUse instanceof Ref_1.AbstractFieldRef) {
            expr.setField(this.newUse);
        }
    }
    caseYieldExpr(expr) {
        if (expr.getYieldValue() === this.oldUse) {
            expr.setYieldValue(this.newUse);
        }
    }
    caseUnopExpr(expr) {
        if (expr.getOp() === this.oldUse) {
            expr.setOp(this.newUse);
        }
    }
}
exports.ExprUseReplacer = ExprUseReplacer;
