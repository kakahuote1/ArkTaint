import { Scene } from '../../Scene';
import { DataflowProblem, FlowFunction } from './DataflowProblem';
import { Local } from '../base/Local';
import { Value } from '../base/Value';
import { ArkAssignStmt, Stmt } from '../base/Stmt';
import { ArkMethod } from '../model/ArkMethod';
import { Constant } from '../base/Constant';
import { DataflowSolver } from './DataflowSolver';
import { FileSignature, NamespaceSignature } from '../model/ArkSignature';
import { ArkClass } from '../model/ArkClass';
import { ArkField } from '../model/ArkField';
export declare class UndefinedVariableChecker extends DataflowProblem<Value> {
    zeroValue: Constant;
    entryPoint: Stmt;
    entryMethod: ArkMethod;
    scene: Scene;
    classMap: Map<FileSignature | NamespaceSignature, ArkClass[]>;
    globalVariableMap: Map<FileSignature | NamespaceSignature, Local[]>;
    outcomes: Outcome[];
    constructor(stmt: Stmt, method: ArkMethod);
    getEntryPoint(): Stmt;
    getEntryMethod(): ArkMethod;
    private isUndefined;
    getNormalFlowFunction(srcStmt: Stmt, tgtStmt: Stmt): FlowFunction<Value>;
    insideNormalFlowFunction(ret: Set<Value>, srcStmt: ArkAssignStmt, dataFact: Value): void;
    getCallFlowFunction(srcStmt: Stmt, method: ArkMethod): FlowFunction<Value>;
    insideCallFlowFunction(ret: Set<Value>, method: ArkMethod): void;
    addUndefinedField(field: ArkField, method: ArkMethod, ret: Set<Value>): void;
    addParameters(srcStmt: Stmt, dataFact: Value, method: ArkMethod, ret: Set<Value>): void;
    getExitToReturnFlowFunction(srcStmt: Stmt, tgtStmt: Stmt, callStmt: Stmt): FlowFunction<Value>;
    getCallToReturnFlowFunction(srcStmt: Stmt, tgtStmt: Stmt): FlowFunction<Value>;
    createZeroValue(): Value;
    getZeroValue(): Value;
    factEqual(d1: Value, d2: Value): boolean;
    getOutcomes(): Outcome[];
}
export declare class UndefinedVariableSolver extends DataflowSolver<Value> {
    constructor(problem: UndefinedVariableChecker, scene: Scene);
}
declare class Outcome {
    value: Value;
    stmt: Stmt;
    constructor(v: Value, s: Stmt);
}
export {};
//# sourceMappingURL=UndefinedVariable.d.ts.map