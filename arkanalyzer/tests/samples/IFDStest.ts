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

import { SceneConfig } from '../../src';
import { Scene } from '../../src';
import { DataflowProblem, FlowFunction } from '../../src';
import { Local } from '../../src';
import { Value } from '../../src';
import { NumberType } from '../../src';
import { ArkAssignStmt, ArkInvokeStmt, ArkReturnStmt, Stmt } from '../../src';
import { ArkMethod } from '../../src';
import { Constant } from '../../src';
import { ModelUtils } from '../../src';
import { DataflowSolver } from '../../src';
import { AbstractBinopExpr } from '../../src/core/base/Expr';
import { Logger, LOG_LEVEL, LOG_MODULE_TYPE } from '../../src';

const logger = Logger.getLogger(LOG_MODULE_TYPE.TOOL, 'IFDSTEST');
Logger.configure('', LOG_LEVEL.ERROR, LOG_LEVEL.INFO, false);

/*
the only statement form in this test case is a = b or a = literal
which a or b is variable
*/
class PossibleDivZeroChecker extends DataflowProblem<Local> {
    zeroValue : Local = new Local("zeroValue");
    entryPoint: Stmt;
    entryMethod: ArkMethod;
    scene: Scene;
    constructor(stmt: Stmt, method: ArkMethod){
        super();
        this.entryPoint = stmt;
        this.entryMethod = method;
        this.scene = method.getDeclaringArkFile().getScene();
    }

    getEntryPoint() : Stmt {
        return this.entryPoint;
    }

    getEntryMethod() : ArkMethod {
        return this.entryMethod;
    }

    public isLiteralZero(val : Value) : boolean {
        if (val instanceof Constant) {
            let constant : Constant = val as Constant;
            if (constant.getType() instanceof NumberType && val.getValue() == '0') {
                return true;
            } 
        }
        return false;
    }

    getNormalFlowFunction(srcStmt:Stmt, tgtStmt:Stmt) : FlowFunction<Local> {
            let checkerInstance: PossibleDivZeroChecker = this;
            return new class implements FlowFunction<Local> {
                getDataFacts(dataFact: Local): Set<Local> {
                    let ret: Set<Local> = new Set();
                    if (checkerInstance.getEntryPoint() == srcStmt && checkerInstance.getZeroValue() == dataFact) {
                        // handle zero fact and entry point case
                        let entryMethod = checkerInstance.getEntryMethod();
                        const parameters =  [...entryMethod.getCfg()!.getBlocks()][0].getStmts().slice(0,entryMethod.getParameters().length);
                        for (let i = 0;i < parameters.length;i++) {
                            const para  = parameters[i].getDef();
                            if (para instanceof Local)
                                ret.add(para);
                        }
                        ret.add(checkerInstance.getZeroValue());
                        return ret;
                    } 
                    if (srcStmt.getDef() != dataFact) {
                        // identity or 0->0 case
                        ret.add(dataFact);
                    } 
                    if (srcStmt instanceof ArkAssignStmt ) {
                        let ass: ArkAssignStmt = (srcStmt as ArkAssignStmt);
                        let assigned : Local = ass.getLeftOp() as Local;
                        let rightOp : Value = ass.getRightOp();
                        if (checkerInstance.getZeroValue() == dataFact) {
                            if (checkerInstance.isLiteralZero(rightOp)) {
                                // case : a = 0
                                ret.add(assigned);
                            }
                        } else if (rightOp == dataFact) {
                            // case : a = dataFact
                            ret.add(assigned);
                        } else if (rightOp instanceof AbstractBinopExpr) {
                            let binaryOp : AbstractBinopExpr = rightOp as AbstractBinopExpr
                            if (binaryOp.getOperator() == '/') {
                                let divisor : Value = binaryOp.getOp2();
                                let dividend : Value = binaryOp.getOp1();
                                if (divisor == dataFact || checkerInstance.isLiteralZero(divisor)) {
                                    logger.info("divison isntruction with zero divisor is detected!")
                                    logger.info(srcStmt.toString());
                                    logger.info(srcStmt.getOriginPositionInfo());
                                } else if (dividend == dataFact) {
                                    ret.add(assigned);
                                } else if (dataFact == checkerInstance.getZeroValue() && checkerInstance.isLiteralZero(dividend)) {
                                    ret.add(assigned);
                                }
                            }
                        }
                    }

                    return ret;
                }
        }
    }

    getCallFlowFunction(srcStmt:Stmt, method:ArkMethod) : FlowFunction<Local> {
        let checkerInstance: PossibleDivZeroChecker = this;
        return new class implements FlowFunction<Local> {
            getDataFacts(dataFact: Local): Set<Local> {
                const ret:Set<Local> = new Set();
                if (checkerInstance.getZeroValue() == dataFact) {
                    ret.add(checkerInstance.getZeroValue());
                }
                const callStmt = srcStmt as ArkInvokeStmt;
                const args = callStmt.getInvokeExpr().getArgs();
                for (let i = 0; i < args.length; i++){
                    if (args[i] == dataFact){
                        // arkmethod的参数类型为ArkParameterRef，不是local，只能通过第一个block的对应位置找到真正参数的定义获取local
                        const realParameter = [...method.getCfg()!.getBlocks()][0].getStmts()[i].getDef();
                        if (realParameter instanceof Local)
                            ret.add(realParameter)
                    }
                    if (checkerInstance.isLiteralZero(args[i])  && checkerInstance.getZeroValue() == dataFact) {
                        const realParameter = [...method.getCfg()!.getBlocks()][0].getStmts()[i].getDef();
                        if (realParameter instanceof Local)
                            ret.add(realParameter)
                    }
                }
                return ret;
            }
        }
    }

    getExitToReturnFlowFunction(srcStmt:Stmt, tgtStmt:Stmt, callStmt:Stmt) : FlowFunction<Local> {
        let checkerInstance: PossibleDivZeroChecker = this;
        return new class implements FlowFunction<Local> {
            getDataFacts(d: Local): Set<Local> {
                let ret : Set<Local> = new Set<Local>();
                if (d == checkerInstance.getZeroValue()) {
                    ret.add(checkerInstance.getZeroValue());
                }
                if (!(callStmt instanceof ArkAssignStmt)) {
                    return ret;
                }
                if (srcStmt instanceof ArkReturnStmt) {
                    let ass: ArkAssignStmt = callStmt as ArkAssignStmt;
                    let leftOp: Local = ass.getLeftOp() as Local;
                    let retVal: Value = (srcStmt as ArkReturnStmt).getOp();
                    if (d == checkerInstance.getZeroValue()) {
                        if (checkerInstance.isLiteralZero(retVal)) {
                            ret.add(leftOp);
                        }
                    } else if (retVal == d) {
                        ret.add(leftOp);
                    }
                }
                return ret;
            }
        }
    }

    getCallToReturnFlowFunction(srcStmt:Stmt, tgtStmt:Stmt) : FlowFunction<Local> {
        let checkerInstance: PossibleDivZeroChecker = this;
        return new class implements FlowFunction<Local> {
            getDataFacts(dataFact: Local): Set<Local> {
                const ret:Set<Local> = new Set();
                if (checkerInstance.getZeroValue() == dataFact) {
                    ret.add(checkerInstance.getZeroValue());
                }
                const defValue = srcStmt.getDef();
                if (!(defValue && defValue == dataFact)){
                    ret.add(dataFact);
                }
                return ret;
            }
        }
    }

    createZeroValue() : Local {
        return this.zeroValue;
    }

    getZeroValue() : Local {
        return this.zeroValue;
    }

    factEqual(d1: Local, d2: Local): boolean {
        return d1 === d2;
    }
}

class instanceSolver extends DataflowSolver<Local> {
    constructor(problem: PossibleDivZeroChecker, scene: Scene){
        super(problem, scene);
    }
}

const prjDir = "tests/resources/ifds/Div0";
let config: SceneConfig = new SceneConfig();
config.buildFromProjectDir(prjDir);
let scene: Scene = new Scene();
scene.buildSceneFromProjectDir(config);
scene.inferTypes();

const defaultMethod = scene.getFiles()[0].getDefaultClass().getDefaultArkMethod();
const method = ModelUtils.getMethodWithName("main", defaultMethod!);
if(method){
    const problem = new PossibleDivZeroChecker([...method.getCfg()!.getBlocks()][0].getStmts()[method.getParameters().length], method);
    const solver = new instanceSolver(problem, scene);
    solver.solve();
}
