"use strict";
/*
 * Copyright (c) 2025 Huawei Device Co., Ltd.
 * Licensed under the Apache License, Version 2.0 (the "License"); * you may not use this file except in compliance with the License.
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
exports.DVFGBuilder = void 0;
const Constant_1 = require("../../core/base/Constant");
const Expr_1 = require("../../core/base/Expr");
const Ref_1 = require("../../core/base/Ref");
const Stmt_1 = require("../../core/base/Stmt");
const ArkIRTransformer_1 = require("../../core/common/ArkIRTransformer");
const GenericDataFlow_1 = require("../../core/dataflow/GenericDataFlow");
const ReachingDef_1 = require("../../core/dataflow/ReachingDef");
class DVFGBuilder {
    constructor(dvfg, s) {
        this.dvfg = dvfg;
        this.scene = s;
    }
    build() {
        this.scene.getMethods().forEach(m => {
            if (m.getCfg()) {
                this.buildForSingleMethod(m);
            }
        });
    }
    buildForSingleMethod(m) {
        let problem = new ReachingDef_1.ReachingDefProblem(m);
        let solver = new GenericDataFlow_1.MFPDataFlowSolver();
        let solution = solver.calculateMopSolutionForwards(problem);
        let defMap = new Map();
        m.getCfg()
            .getStmts()
            .forEach(s => {
            var _a;
            let def = s.getDef();
            if (def != null) {
                if (def instanceof Ref_1.AbstractFieldRef) {
                    def = def.getFieldSignature();
                }
                let defStmts = (_a = defMap.get(def)) !== null && _a !== void 0 ? _a : new Set();
                defStmts.add(s);
                defMap.set(def, defStmts);
            }
        });
        solution.in.forEach((defs, reach) => {
            let addNewNodes = (defId, def, reach) => {
                if (defs.test(defId)) {
                    let srcNode = this.dvfg.getOrNewDVFGNode(def);
                    let dstNode = this.dvfg.getOrNewDVFGNode(reach);
                    this.dvfg.addDVFGEdge(srcNode, dstNode);
                }
            };
            const reachStmt = problem.flowGraph.getNode(reach);
            this.getStmtUsedValues(reachStmt).forEach(use => {
                var _a;
                let target = use;
                if (target instanceof Ref_1.AbstractFieldRef) {
                    target = target.getFieldSignature();
                }
                (_a = defMap.get(target)) === null || _a === void 0 ? void 0 : _a.forEach(defStmt => {
                    let defId = problem.flowGraph.getNodeID(defStmt);
                    addNewNodes(defId, defStmt, reachStmt);
                });
            });
        });
    }
    getStmtUsedValues(stmt) {
        if (stmt instanceof Stmt_1.ArkAssignStmt) {
            return this.getUsedValues(stmt.getRightOp());
        }
        else if (stmt instanceof Stmt_1.ArkInvokeStmt) {
            return this.getUsedValues(stmt.getInvokeExpr());
        }
        else if (stmt instanceof Stmt_1.ArkIfStmt) {
            return this.getUsedValues(stmt.getConditionExpr());
        }
        else if (stmt instanceof Stmt_1.ArkReturnStmt) {
            return this.getUsedValues(stmt.getOp());
        }
        else if (stmt instanceof Stmt_1.ArkThrowStmt) {
            return this.getUsedValues(stmt.getOp());
        }
        else if (stmt instanceof Stmt_1.ArkReturnVoidStmt || stmt instanceof Stmt_1.ArkAliasTypeDefineStmt || stmt instanceof ArkIRTransformer_1.DummyStmt) {
            return [];
        }
        else {
            throw new Error('unsupported stmt');
        }
    }
    getUsedValues(val) {
        if (val instanceof Expr_1.AbstractExpr) {
            if (val instanceof Expr_1.AbstractInvokeExpr) {
                return val.getArgs().flatMap(current => {
                    return this.getUsedValues(current);
                }, []);
            }
            else {
                return val.getUses().flatMap(current => {
                    return this.getUsedValues(current);
                }, []);
            }
        }
        if (val instanceof Constant_1.Constant) {
            return [];
        }
        return [val];
    }
    getOrNewDVFGNode(stmt) {
        return this.dvfg.getOrNewDVFGNode(stmt);
    }
    addDVFGNodes() { }
    addDVFGEdges() { }
}
exports.DVFGBuilder = DVFGBuilder;
