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
exports.UndefinedVariableSolver = exports.UndefinedVariableChecker = void 0;
const DataflowProblem_1 = require("./DataflowProblem");
const Local_1 = require("../base/Local");
const Type_1 = require("../base/Type");
const Stmt_1 = require("../base/Stmt");
const Constant_1 = require("../base/Constant");
const Ref_1 = require("../base/Ref");
const DataflowSolver_1 = require("./DataflowSolver");
const Expr_1 = require("../base/Expr");
const Util_1 = require("./Util");
const Const_1 = require("../common/Const");
const logger_1 = __importStar(require("../../utils/logger"));
const logger = logger_1.default.getLogger(logger_1.LOG_MODULE_TYPE.ARKANALYZER, 'Scene');
class UndefinedVariableChecker extends DataflowProblem_1.DataflowProblem {
    constructor(stmt, method) {
        super();
        this.zeroValue = new Constant_1.Constant('undefined', Type_1.UndefinedType.getInstance());
        this.outcomes = [];
        this.entryPoint = stmt;
        this.entryMethod = method;
        this.scene = method.getDeclaringArkFile().getScene();
        this.classMap = this.scene.getClassMap();
        this.globalVariableMap = this.scene.getGlobalVariableMap();
    }
    getEntryPoint() {
        return this.entryPoint;
    }
    getEntryMethod() {
        return this.entryMethod;
    }
    isUndefined(val) {
        if (val instanceof Constant_1.Constant) {
            let constant = val;
            if (constant.getType() instanceof Type_1.UndefinedType) {
                return true;
            }
        }
        return false;
    }
    getNormalFlowFunction(srcStmt, tgtStmt) {
        let checkerInstance = this;
        return new (class {
            getDataFacts(dataFact) {
                let ret = new Set();
                if (checkerInstance.getEntryPoint() === srcStmt && checkerInstance.getZeroValue() === dataFact) {
                    ret.add(checkerInstance.getZeroValue());
                    return ret;
                }
                if (srcStmt instanceof Stmt_1.ArkAssignStmt) {
                    checkerInstance.insideNormalFlowFunction(ret, srcStmt, dataFact);
                }
                return ret;
            }
        })();
    }
    insideNormalFlowFunction(ret, srcStmt, dataFact) {
        if (!this.factEqual(srcStmt.getDef(), dataFact)) {
            if (!(dataFact instanceof Local_1.Local && dataFact.getName() === srcStmt.getDef().toString())) {
                ret.add(dataFact);
            }
        }
        let ass = srcStmt;
        let assigned = ass.getLeftOp();
        let rightOp = ass.getRightOp();
        if (this.getZeroValue() === dataFact) {
            if (this.isUndefined(rightOp)) {
                ret.add(assigned);
            }
        }
        else if (this.factEqual(rightOp, dataFact) || rightOp.getType() instanceof Type_1.UndefinedType) {
            ret.add(assigned);
        }
        else if (rightOp instanceof Ref_1.ArkInstanceFieldRef) {
            const base = rightOp.getBase();
            if (base === dataFact || (!base.getDeclaringStmt() && base.getName() === dataFact.toString())) {
                this.outcomes.push(new Outcome(rightOp, ass));
                logger.info('undefined base');
                logger.info(srcStmt.toString());
                logger.info(srcStmt.getOriginPositionInfo().toString());
            }
        }
        else if (dataFact instanceof Ref_1.ArkInstanceFieldRef && rightOp === dataFact.getBase()) {
            const field = new Ref_1.ArkInstanceFieldRef(srcStmt.getLeftOp(), dataFact.getFieldSignature());
            ret.add(field);
        }
    }
    getCallFlowFunction(srcStmt, method) {
        let checkerInstance = this;
        return new (class {
            getDataFacts(dataFact) {
                const ret = new Set();
                if (checkerInstance.getZeroValue() === dataFact) {
                    checkerInstance.insideCallFlowFunction(ret, method);
                }
                else {
                    const callExpr = srcStmt.getExprs()[0];
                    if (callExpr instanceof Expr_1.ArkInstanceInvokeExpr &&
                        dataFact instanceof Ref_1.ArkInstanceFieldRef &&
                        callExpr.getBase().getName() === dataFact.getBase().getName()) {
                        // todo:base转this
                        const thisRef = new Ref_1.ArkInstanceFieldRef(new Local_1.Local('this', new Type_1.ClassType(method.getDeclaringArkClass().getSignature())), dataFact.getFieldSignature());
                        ret.add(thisRef);
                    }
                    else if (callExpr instanceof Expr_1.ArkStaticInvokeExpr &&
                        dataFact instanceof Ref_1.ArkStaticFieldRef &&
                        callExpr.getMethodSignature().getDeclaringClassSignature() === dataFact.getFieldSignature().getDeclaringSignature()) {
                        ret.add(dataFact);
                    }
                }
                checkerInstance.addParameters(srcStmt, dataFact, method, ret);
                return ret;
            }
        })();
    }
    insideCallFlowFunction(ret, method) {
        ret.add(this.getZeroValue());
        // 加上调用函数能访问到的所有静态变量，如果不考虑多线程，加上所有变量，考虑则要统计之前已经处理过的变量并排除
        for (const field of method.getDeclaringArkClass().getStaticFields(this.classMap)) {
            if (field.getInitializer() === undefined) {
                ret.add(new Ref_1.ArkStaticFieldRef(field.getSignature()));
            }
        }
        for (const local of method.getDeclaringArkClass().getGlobalVariable(this.globalVariableMap)) {
            ret.add(local);
        }
        // 加上所有未定义初始值的属性
        if (method.getName() === Const_1.INSTANCE_INIT_METHOD_NAME || method.getName() === Const_1.STATIC_INIT_METHOD_NAME) {
            for (const field of method.getDeclaringArkClass().getFields()) {
                this.addUndefinedField(field, method, ret);
            }
        }
    }
    addUndefinedField(field, method, ret) {
        let defined = false;
        for (const stmt of method.getCfg().getStmts()) {
            const def = stmt.getDef();
            if (def instanceof Ref_1.ArkInstanceFieldRef && def.getFieldSignature() === field.getSignature()) {
                defined = true;
                break;
            }
        }
        if (!defined) {
            const fieldRef = new Ref_1.ArkInstanceFieldRef(new Local_1.Local('this', new Type_1.ClassType(method.getDeclaringArkClass().getSignature())), field.getSignature());
            ret.add(fieldRef);
        }
    }
    addParameters(srcStmt, dataFact, method, ret) {
        const callStmt = srcStmt;
        const args = callStmt.getInvokeExpr().getArgs();
        for (let i = 0; i < args.length; i++) {
            if (args[i] === dataFact || (this.isUndefined(args[i]) && this.getZeroValue() === dataFact)) {
                const realParameter = method.getCfg().getStartingBlock().getStmts()[i].getDef();
                if (realParameter) {
                    ret.add(realParameter);
                }
            }
            else if (dataFact instanceof Ref_1.ArkInstanceFieldRef && dataFact.getBase().getName() === args[i].toString()) {
                const realParameter = method.getCfg().getStartingBlock().getStmts()[i].getDef();
                if (realParameter) {
                    const retRef = new Ref_1.ArkInstanceFieldRef(realParameter, dataFact.getFieldSignature());
                    ret.add(retRef);
                }
            }
        }
    }
    getExitToReturnFlowFunction(srcStmt, tgtStmt, callStmt) {
        let checkerInstance = this;
        return new (class {
            getDataFacts(dataFact) {
                let ret = new Set();
                if (dataFact === checkerInstance.getZeroValue()) {
                    ret.add(checkerInstance.getZeroValue());
                }
                return ret;
            }
        })();
    }
    getCallToReturnFlowFunction(srcStmt, tgtStmt) {
        let checkerInstance = this;
        return new (class {
            getDataFacts(dataFact) {
                const ret = new Set();
                if (checkerInstance.getZeroValue() === dataFact) {
                    ret.add(checkerInstance.getZeroValue());
                }
                const defValue = srcStmt.getDef();
                if (!(defValue && defValue === dataFact)) {
                    ret.add(dataFact);
                }
                return ret;
            }
        })();
    }
    createZeroValue() {
        return this.zeroValue;
    }
    getZeroValue() {
        return this.zeroValue;
    }
    factEqual(d1, d2) {
        if (d1 instanceof Constant_1.Constant && d2 instanceof Constant_1.Constant) {
            return d1 === d2;
        }
        else if (d1 instanceof Local_1.Local && d2 instanceof Local_1.Local) {
            return (0, Util_1.LocalEqual)(d1, d2);
        }
        else if (d1 instanceof Ref_1.AbstractRef && d2 instanceof Ref_1.AbstractRef) {
            return (0, Util_1.RefEqual)(d1, d2);
        }
        return false;
    }
    getOutcomes() {
        return this.outcomes;
    }
}
exports.UndefinedVariableChecker = UndefinedVariableChecker;
class UndefinedVariableSolver extends DataflowSolver_1.DataflowSolver {
    constructor(problem, scene) {
        super(problem, scene);
    }
}
exports.UndefinedVariableSolver = UndefinedVariableSolver;
class Outcome {
    constructor(v, s) {
        this.value = v;
        this.stmt = s;
    }
}
