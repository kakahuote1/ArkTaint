import * as ts from 'ohos-typescript';
import { Local } from '../../base/Local';
import { ArkAliasTypeDefineStmt } from '../../base/Stmt';
import { BasicBlock } from '../BasicBlock';
import { Cfg } from '../Cfg';
import { ArkClass } from '../../model/ArkClass';
import { ArkMethod } from '../../model/ArkMethod';
import { AliasType } from '../../base/Type';
import { Trap } from '../../base/Trap';
import { GlobalRef } from '../../base/Ref';
declare class StatementBuilder {
    type: string;
    code: string;
    next: StatementBuilder | null;
    lasts: Set<StatementBuilder>;
    walked: boolean;
    index: number;
    line: number;
    column: number;
    astNode: ts.Node | null;
    scopeID: number;
    addressCode3: string[];
    block: BlockBuilder | null;
    ifExitPass: boolean;
    passTmies: number;
    numOfIdentifier: number;
    isDoWhile: boolean;
    constructor(type: string, code: string, astNode: ts.Node | null, scopeID: number);
}
declare class ConditionStatementBuilder extends StatementBuilder {
    nextT: StatementBuilder | null;
    nextF: StatementBuilder | null;
    loopBlock: BlockBuilder | null;
    condition: string;
    doStatement: StatementBuilder | null;
    constructor(type: string, code: string, astNode: ts.Node, scopeID: number);
}
export declare class SwitchStatementBuilder extends StatementBuilder {
    nexts: StatementBuilder[];
    cases: Case[];
    default: StatementBuilder | null;
    afterSwitch: StatementBuilder | null;
    constructor(type: string, code: string, astNode: ts.Node, scopeID: number);
}
export declare class TryStatementBuilder extends StatementBuilder {
    tryFirst: StatementBuilder | null;
    tryExit: StatementBuilder | null;
    catchStatement: StatementBuilder | null;
    catchError: string;
    finallyStatement: StatementBuilder | null;
    afterFinal: StatementBuilder | null;
    constructor(type: string, code: string, astNode: ts.Node, scopeID: number);
}
declare class Case {
    value: string;
    stmt: StatementBuilder;
    valueNode: ts.Node;
    constructor(value: string, stmt: StatementBuilder);
}
declare class DefUseChain {
    def: StatementBuilder;
    use: StatementBuilder;
    constructor(def: StatementBuilder, use: StatementBuilder);
}
declare class Variable {
    name: string;
    lastDef: StatementBuilder;
    defUse: DefUseChain[];
    properties: Variable[];
    propOf: Variable | null;
    constructor(name: string, lastDef: StatementBuilder);
}
declare class Scope {
    id: number;
    constructor(id: number);
}
export declare class BlockBuilder {
    id: number;
    stmts: StatementBuilder[];
    nexts: BlockBuilder[];
    lasts: BlockBuilder[];
    walked: boolean;
    constructor(id: number, stmts: StatementBuilder[]);
    removePredecessorBlock(block: BlockBuilder): boolean;
    removeSuccessorBlock(block: BlockBuilder): boolean;
}
declare class Catch {
    errorName: string;
    from: number;
    to: number;
    withLabel: number;
    constructor(errorName: string, from: number, to: number, withLabel: number);
}
export declare class CfgBuilder {
    name: string;
    astRoot: ts.Node;
    entry: StatementBuilder;
    exit: StatementBuilder;
    loopStack: ConditionStatementBuilder[];
    switchExitStack: StatementBuilder[];
    functions: CfgBuilder[];
    breakin: string;
    statementArray: StatementBuilder[];
    dotEdges: number[][];
    scopes: Scope[];
    tempVariableNum: number;
    current3ACstm: StatementBuilder;
    blocks: BlockBuilder[];
    currentDeclarationKeyword: string;
    variables: Variable[];
    declaringClass: ArkClass;
    importFromPath: string[];
    catches: Catch[];
    exits: StatementBuilder[];
    emptyBody: boolean;
    arrowFunctionWithoutBlock: boolean;
    private sourceFile;
    private declaringMethod;
    constructor(ast: ts.Node, name: string, declaringMethod: ArkMethod, sourceFile: ts.SourceFile);
    getDeclaringMethod(): ArkMethod;
    judgeLastType(s: StatementBuilder, lastStatement: StatementBuilder): void;
    ASTNodeBreakStatement(c: ts.Node, lastStatement: StatementBuilder): void;
    ASTNodeIfStatement(c: ts.IfStatement, lastStatement: StatementBuilder, scopeID: number): StatementBuilder;
    ASTNodeWhileStatement(c: ts.WhileStatement, lastStatement: StatementBuilder, scopeID: number): StatementBuilder;
    ASTNodeForStatement(c: ts.ForInOrOfStatement | ts.ForStatement, lastStatement: StatementBuilder, scopeID: number): StatementBuilder;
    ASTNodeDoStatement(c: ts.DoStatement, lastStatement: StatementBuilder, scopeID: number): StatementBuilder;
    ASTNodeSwitchStatement(c: ts.SwitchStatement, lastStatement: StatementBuilder, scopeID: number): StatementBuilder;
    ASTNodeTryStatement(c: ts.TryStatement, lastStatement: StatementBuilder, scopeID: number): StatementBuilder;
    walkAST(lastStatement: StatementBuilder, nextStatement: StatementBuilder, nodes: ts.Node[]): void;
    addReturnInEmptyMethod(): void;
    deleteExitAfterCondition(last: ConditionStatementBuilder, exit: StatementBuilder): void;
    deleteExitAfterSwitch(last: SwitchStatementBuilder, exit: StatementBuilder): void;
    deleteExit(): void;
    addStmt2BlockStmtQueueInSpecialCase(stmt: StatementBuilder, stmtQueue: StatementBuilder[]): StatementBuilder | null;
    addStmt2BlockStmtQueue(stmt: StatementBuilder, stmtQueue: StatementBuilder[]): StatementBuilder | null;
    buildBlocks(): void;
    buildConditionNextBlocks(originStatement: ConditionStatementBuilder, block: BlockBuilder, isLastStatement: boolean): void;
    buildSwitchNextBlocks(originStatement: SwitchStatementBuilder, block: BlockBuilder, isLastStatement: boolean): void;
    buildNormalNextBlocks(originStatement: StatementBuilder, block: BlockBuilder, isLastStatement: boolean): void;
    buildBlocksNextLast(): void;
    addReturnBlock(returnStatement: StatementBuilder, notReturnStmts: StatementBuilder[]): void;
    addReturnStmt(): void;
    resetWalked(): void;
    addStmtBuilderPosition(): void;
    CfgBuilder2Array(stmt: StatementBuilder): void;
    getDotEdges(stmt: StatementBuilder): void;
    errorTest(stmt: StatementBuilder): void;
    buildStatementBuilder4ArrowFunction(stmt: ts.Node): void;
    private getParamNodeWithInitializerOrModifier;
    buildCfgBuilder(): void;
    private handleBuilder;
    isBodyEmpty(): boolean;
    buildCfg(): {
        cfg: Cfg;
        locals: Set<Local>;
        globals: Map<string, GlobalRef> | null;
        aliasTypeMap: Map<string, [AliasType, ArkAliasTypeDefineStmt]>;
        traps: Trap[];
    };
    buildCfgForSimpleArrowFunction(): {
        cfg: Cfg;
        locals: Set<Local>;
        globals: Map<string, GlobalRef> | null;
        aliasTypeMap: Map<string, [AliasType, ArkAliasTypeDefineStmt]>;
        traps: Trap[];
    };
    buildNormalCfg(): {
        cfg: Cfg;
        locals: Set<Local>;
        globals: Map<string, GlobalRef> | null;
        aliasTypeMap: Map<string, [AliasType, ArkAliasTypeDefineStmt]>;
        traps: Trap[];
    };
    private removeEmptyBlocks;
    private initializeBuild;
    private processBlocks;
    private generateReturnStmt;
    private adjustBlocks;
    private createCfg;
    private topologicalSortBlock;
    private linkBasicBlocks;
    static replaceBlockBuilderAndBasicBlock(blockBuilderToCfgBlock: Map<BlockBuilder, BasicBlock>, oldBlockBuilder: BlockBuilder, newBlockBuilder: BlockBuilder): void;
    static replaceBlockBuilder(oldBlockBuilder: BlockBuilder, newBlockBuilder: BlockBuilder): void;
    static replaceBlockBuilderInPredecessors(oldBlockBuilder: BlockBuilder, newBlockBuilder: BlockBuilder): void;
    static replaceBlockBuilderInSuccessors(oldBlockBuilder: BlockBuilder, newBlockBuilder: BlockBuilder): void;
    static unlinkPredecessorsOfBlockBuilder(blockBuilder: BlockBuilder): void;
    static unlinkSuccessorsOfBlockBuilder(blockBuilder: BlockBuilder): void;
    static unlinkBlockBuilder(predecessor: BlockBuilder, successor: BlockBuilder): void;
    static unlinkPredecessorsAndSuccessorsOfBlockBuilder(blockBuilder: BlockBuilder): void;
    static pruneBlockBuilder(blockBuilder: BlockBuilder): boolean;
    static replaceBasicBlock(oldBasicBlock: BasicBlock, newBasicBlock: BasicBlock): void;
    static replaceBasicBlockInPredecessors(oldBasicBlock: BasicBlock, newBasicBlock: BasicBlock): void;
    static replaceBasicBlockInSuccessors(oldBasicBlock: BasicBlock, newBasicBlocks: BasicBlock[]): void;
    static linkPredecessorsOfBasicBlock(basicBlock: BasicBlock, predecessors: BasicBlock[]): void;
    static unlinkPredecessorsOfBasicBlock(basicBlock: BasicBlock): void;
    static unlinkSuccessorsOfBasicBlock(basicBlock: BasicBlock): void;
    static linkSuccessorOfIfBasicBlock(ifBasicBlock: BasicBlock, trueBranchSuccessor: BasicBlock, falseBranchSuccessor: BasicBlock): void;
    static unlinkPredecessorsAndSuccessorsOfBasicBlock(basicBlock: BasicBlock): void;
    static pruneBasicBlock(basicBlock: BasicBlock): boolean;
    static linkBasicBlock(predecessor: BasicBlock, successor: BasicBlock): void;
    static unlinkBasicBlock(predecessor: BasicBlock, successor: BasicBlock): void;
    static linkExceptionalBasicBlock(predecessor: BasicBlock, exceptionalSuccessor: BasicBlock): void;
}
export {};
