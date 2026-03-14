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

import { Constant } from '../../core/base/Constant';
import { AbstractExpr, AbstractInvokeExpr } from '../../core/base/Expr';
import { AbstractFieldRef } from '../../core/base/Ref';
import { ArkAssignStmt, ArkInvokeStmt, ArkIfStmt, ArkReturnStmt, ArkThrowStmt, Stmt, ArkReturnVoidStmt, ArkAliasTypeDefineStmt } from '../../core/base/Stmt';
import { Value } from '../../core/base/Value';
import { DummyStmt } from '../../core/common/ArkIRTransformer';
import { MFPDataFlowSolver } from '../../core/dataflow/GenericDataFlow';
import { ReachingDefProblem } from '../../core/dataflow/ReachingDef';
import { NodeID } from '../../core/graph/BaseExplicitGraph';
import { ArkMethod } from '../../core/model/ArkMethod';
import { FieldSignature } from '../../core/model/ArkSignature';
import { Scene } from '../../Scene';
import { DVFG, DVFGNode } from '../DVFG';

export class DVFGBuilder {
    private dvfg: DVFG;
    private scene: Scene;

    constructor(dvfg: DVFG, s: Scene) {
        this.dvfg = dvfg;
        this.scene = s;
    }

    public build(): void {
        this.scene.getMethods().forEach(m => {
            if (m.getCfg()) {
                this.buildForSingleMethod(m);
            }
        });
    }

    public buildForSingleMethod(m: ArkMethod): void {
        let problem = new ReachingDefProblem(m);
        let solver = new MFPDataFlowSolver();
        let solution = solver.calculateMopSolutionForwards(problem);

        let defMap = new Map<Value | FieldSignature, Set<Stmt>>();
        m.getCfg()!
            .getStmts()
            .forEach(s => {
                let def: Value | FieldSignature | null = s.getDef();
                if (def != null) {
                    if (def instanceof AbstractFieldRef) {
                        def = def.getFieldSignature();
                    }
                    let defStmts = defMap.get(def) ?? new Set<Stmt>();
                    defStmts.add(s);
                    defMap.set(def, defStmts);
                }
            });

        solution.in.forEach((defs, reach) => {
            let addNewNodes = (defId: NodeID, def: Stmt, reach: Stmt): void => {
                if (defs.test(defId)) {
                    let srcNode = this.dvfg.getOrNewDVFGNode(def);
                    let dstNode = this.dvfg.getOrNewDVFGNode(reach);
                    this.dvfg.addDVFGEdge(srcNode, dstNode);
                }
            };

            const reachStmt = problem.flowGraph.getNode(reach);
            this.getStmtUsedValues(reachStmt).forEach(use => {
                let target: Value | FieldSignature = use;
                if (target instanceof AbstractFieldRef) {
                    target = target.getFieldSignature();
                }
                defMap.get(target)?.forEach(defStmt => {
                    let defId = problem.flowGraph.getNodeID(defStmt);
                    addNewNodes(defId, defStmt, reachStmt);
                });
            });
        });
    }

    private getStmtUsedValues(stmt: Stmt): Value[] {
        if (stmt instanceof ArkAssignStmt) {
            return this.getUsedValues(stmt.getRightOp());
        } else if (stmt instanceof ArkInvokeStmt) {
            return this.getUsedValues(stmt.getInvokeExpr());
        } else if (stmt instanceof ArkIfStmt) {
            return this.getUsedValues(stmt.getConditionExpr());
        } else if (stmt instanceof ArkReturnStmt) {
            return this.getUsedValues(stmt.getOp());
        } else if (stmt instanceof ArkThrowStmt) {
            return this.getUsedValues(stmt.getOp());
        } else if (stmt instanceof ArkReturnVoidStmt || stmt instanceof ArkAliasTypeDefineStmt || stmt instanceof DummyStmt) {
            return [];
        } else {
            throw new Error('unsupported stmt');
        }
    }

    private getUsedValues(val: Value): Value[] {
        if (val instanceof AbstractExpr) {
            if (val instanceof AbstractInvokeExpr) {
                return val.getArgs().flatMap(current => {
                    return this.getUsedValues(current);
                }, []);
            } else {
                return val.getUses().flatMap(current => {
                    return this.getUsedValues(current);
                }, []);
            }
        }
        if (val instanceof Constant) {
            return [];
        }
        return [val];
    }

    public getOrNewDVFGNode(stmt: Stmt): DVFGNode {
        return this.dvfg.getOrNewDVFGNode(stmt);
    }

    public addDVFGNodes(): void {}

    public addDVFGEdges(): void {}
}
