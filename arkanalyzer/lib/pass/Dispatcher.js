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
exports.Dispatcher = exports.Dispatch = void 0;
const Stmt_1 = require("../core/base/Stmt");
const Expr_1 = require("../core/base/Expr");
const Constant_1 = require("../core/base/Constant");
const logger_1 = __importStar(require("../utils/logger"));
const Local_1 = require("../core/base/Local");
const Ref_1 = require("../core/base/Ref");
const logger = logger_1.default.getLogger(logger_1.LOG_MODULE_TYPE.ARKANALYZER, 'Inst');
/**
 * Represents all statement types used within the system.
 */
const STMTS = [
    Stmt_1.ArkAssignStmt,
    Stmt_1.ArkInvokeStmt,
    Stmt_1.ArkIfStmt,
    Stmt_1.ArkReturnStmt,
    Stmt_1.ArkReturnVoidStmt,
    Stmt_1.ArkThrowStmt,
    Stmt_1.ArkAliasTypeDefineStmt,
    Stmt_1.Stmt,
];
/**
 * Represents all values types used within the system.
 */
const VALUES = [
    // expr
    Expr_1.AliasTypeExpr,
    Expr_1.ArkUnopExpr,
    Expr_1.ArkPhiExpr,
    Expr_1.ArkCastExpr,
    Expr_1.ArkInstanceOfExpr,
    Expr_1.ArkTypeOfExpr,
    Expr_1.ArkNormalBinopExpr,
    Expr_1.ArkConditionExpr,
    Expr_1.AbstractBinopExpr,
    Expr_1.ArkYieldExpr,
    Expr_1.ArkAwaitExpr,
    Expr_1.ArkDeleteExpr,
    Expr_1.ArkNewArrayExpr,
    Expr_1.ArkNewExpr,
    Expr_1.ArkPtrInvokeExpr,
    Expr_1.ArkStaticInvokeExpr,
    Expr_1.ArkInstanceInvokeExpr,
    Expr_1.AbstractInvokeExpr,
    Expr_1.AbstractExpr,
    // ref
    Ref_1.ClosureFieldRef,
    Ref_1.GlobalRef,
    Ref_1.ArkCaughtExceptionRef,
    Ref_1.ArkThisRef,
    Ref_1.ArkParameterRef,
    Ref_1.ArkStaticFieldRef,
    Ref_1.ArkInstanceFieldRef,
    Ref_1.AbstractFieldRef,
    Ref_1.AbstractRef,
    // constant
    Constant_1.UndefinedConstant,
    Constant_1.NullConstant,
    Constant_1.StringConstant,
    Constant_1.BigIntConstant,
    Constant_1.NumberConstant,
    Constant_1.BooleanConstant,
    Constant_1.Constant,
    // local
    Local_1.Local,
];
/**
 * the dispatch table, it can be cached
 */
class Dispatch {
    constructor(stmts = [], values = []) {
        this.name = 'dispatch';
        this.stmts = [];
        this.smap = new Map();
        this.values = [];
        this.vmap = new Map();
        this.stmts = stmts.map(v => v[0]);
        const smap = new Map();
        for (const [k, v] of stmts) {
            if (Array.isArray(v)) {
                smap.set(k, v);
            }
            else {
                smap.set(k, [v]);
            }
        }
        // replace it, in case of modified
        this.smap = smap;
        this.values = values.map(v => v[0]);
        const vmap = new Map();
        for (const [k, v] of values) {
            if (Array.isArray(v)) {
                vmap.set(k, v);
            }
            else {
                vmap.set(k, [v]);
            }
        }
        // replace it, in case of modified
        this.vmap = vmap;
    }
}
exports.Dispatch = Dispatch;
/**
 * the ArkIR dispatcher, to dispatch stmts and values actions
 */
class Dispatcher {
    constructor(ctx, dispatch = new Dispatch()) {
        // action when match stmts
        this.fallAction = 1 /* FallAction.Break */;
        // value cache to prevent cycle dependencies
        this.cache = new Set();
        this.ctx = ctx;
        this.dispatch = dispatch;
    }
    dispatchStmt(mtd, stmt) {
        var _a;
        logger.debug(`dispatch stmt ${stmt}`);
        const tys = this.dispatch.stmts;
        for (let ty of tys) {
            if (stmt instanceof ty) {
                let pass = (_a = this.dispatch.smap.get(ty)) !== null && _a !== void 0 ? _a : [];
                for (const p of pass) {
                    p(stmt, this.ctx, mtd);
                }
                if (this.fallAction === 1 /* FallAction.Break */) {
                    break;
                }
            }
        }
        for (let use of stmt.getUses()) {
            this.dispatchValue(mtd, use);
        }
    }
    dispatchValue(mtd, value) {
        var _a;
        logger.debug(`dispatch value ${value}`);
        // skip uses if there is no value pass
        if (this.dispatch.values.length === 0) {
            return;
        }
        if (this.cache.has(value)) {
            return;
        }
        this.cache.add(value);
        const tys = this.dispatch.values;
        for (let ty of tys) {
            if (value instanceof ty) {
                let pass = (_a = this.dispatch.vmap.get(ty)) !== null && _a !== void 0 ? _a : [];
                for (const p of pass) {
                    p(value, this.ctx, mtd);
                }
                if (this.fallAction === 1 /* FallAction.Break */) {
                    break;
                }
            }
        }
        for (let use of value.getUses()) {
            this.dispatchValue(mtd, use);
        }
    }
}
exports.Dispatcher = Dispatcher;
