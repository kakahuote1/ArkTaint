import { ArkNewArrayExpr } from '../../core/base/Expr';
import { Local } from '../../core/base/Local';
import { ArkAssignStmt, ArkIfStmt, ArkInvokeStmt, ArkReturnStmt, ArkReturnVoidStmt, ArkThrowStmt, Stmt } from '../../core/base/Stmt';
import { AliasType } from '../../core/base/Type';
import { Value } from '../../core/base/Value';
import { BasicBlock } from '../../core/graph/BasicBlock';
import { ArkCodeBuffer } from '../ArkStream';
import { StmtReader } from './SourceBody';
import { SourceTransformer, TransformerContext } from './SourceTransformer';
import { Dump } from '../base/BasePrinter';
export interface StmtPrinterContext extends TransformerContext {
    getStmtReader(): StmtReader;
    setTempCode(temp: string, code: string): void;
    hasTempVisit(temp: string): boolean;
    setTempVisit(temp: string): void;
    setSkipStmt(stmt: Stmt): void;
    getLocals(): Map<string, Local>;
    defineLocal(local: Local): void;
    isLocalDefined(local: Local): boolean;
    isInDefaultMethod(): boolean;
}
export declare abstract class SourceStmt implements Dump {
    original: Stmt;
    context: StmtPrinterContext;
    line: number;
    text: string;
    transformer: SourceTransformer;
    constructor(context: StmtPrinterContext, original: Stmt);
    getLine(): number;
    setLine(line: number): void;
    dump(): string;
    protected beforeDump(): void;
    protected afterDump(): void;
    protected dumpTs(): string;
    protected get printer(): ArkCodeBuffer;
    toString(): string;
    protected setText(text: string): void;
    protected getIntent(): string;
    abstract transfer2ts(): void;
    protected isLocalTempValue(value: Value): boolean;
}
export declare class SourceAssignStmt extends SourceStmt {
    private leftOp;
    private rightOp;
    private leftCode;
    private rightCode;
    private dumpType?;
    private leftTypeCode;
    constructor(context: StmtPrinterContext, original: ArkAssignStmt);
    transfer2ts(): void;
    protected beforeDump(): void;
    protected afterDump(): void;
    private getClassOriginType;
    /**
     * temp1 = new Person
     * temp1.constructor(10)
     */
    private transferRightNewExpr;
    private handleConstructorInvoke;
    private transferConstructorInvokeExpr;
    /**
     * $temp0 = newarray[4]
     * $temp0[0] = 1
     * $temp0[1] = 2
     * $temp0[2] = 3
     */
    private transferRightNewArrayExpr;
    private transferRightComponentCreate;
    private transferRightComponentAttribute;
}
export declare class SourceInvokeStmt extends SourceStmt {
    constructor(context: StmtPrinterContext, original: ArkInvokeStmt);
    transfer2ts(): void;
    protected beforeDump(): void;
    protected afterDump(): void;
}
export declare class SourceIfStmt extends SourceStmt {
    constructor(context: StmtPrinterContext, original: ArkIfStmt);
    transfer2ts(): void;
    protected afterDump(): void;
}
export declare class SourceWhileStmt extends SourceStmt {
    block: BasicBlock;
    constructor(context: StmtPrinterContext, original: ArkIfStmt, block: BasicBlock);
    protected afterDump(): void;
    /**
     * $temp2 = $temp1.next()
     * $temp3 = $temp2.done()
     * if $temp3 === true
     *  $temp4 = $temp2.value
     *  $temp5 = <> cast
     * @returns
     */
    private forOf2ts;
    private getForOf2ts;
    transfer2ts(): void;
    protected valueToString(value: Value): string;
}
export declare class SourceForStmt extends SourceWhileStmt {
    incBlock: BasicBlock;
    constructor(context: StmtPrinterContext, original: ArkIfStmt, block: BasicBlock, incBlock: BasicBlock);
    transfer2ts(): void;
}
export declare class SourceDoStmt extends SourceStmt {
    constructor(context: StmtPrinterContext, stmt: Stmt);
    transfer2ts(): void;
    protected afterDump(): void;
}
export declare class SourceDoWhileStmt extends SourceWhileStmt {
    constructor(context: StmtPrinterContext, stmt: ArkIfStmt, block: BasicBlock);
    transfer2ts(): void;
    protected beforeDump(): void;
    protected afterDump(): void;
}
export declare class SourceElseStmt extends SourceStmt {
    constructor(context: StmtPrinterContext, original: Stmt);
    transfer2ts(): void;
    protected beforeDump(): void;
    protected afterDump(): void;
}
export declare class SourceContinueStmt extends SourceStmt {
    constructor(context: StmtPrinterContext, original: Stmt);
    transfer2ts(): void;
}
export declare class SourceBreakStmt extends SourceStmt {
    constructor(context: StmtPrinterContext, original: Stmt);
    transfer2ts(): void;
}
export declare class SourceReturnStmt extends SourceStmt {
    constructor(context: StmtPrinterContext, original: ArkReturnStmt);
    transfer2ts(): void;
}
export declare class SourceReturnVoidStmt extends SourceStmt {
    constructor(context: StmtPrinterContext, original: ArkReturnVoidStmt);
    transfer2ts(): void;
}
export declare class SourceCompoundEndStmt extends SourceStmt {
    constructor(context: StmtPrinterContext, stmt: Stmt, text: string);
    transfer2ts(): void;
    protected beforeDump(): void;
}
export declare class SourceCommonStmt extends SourceStmt {
    constructor(context: StmtPrinterContext, stmt: Stmt);
    transfer2ts(): void;
}
export declare class SourceThrowStmt extends SourceStmt {
    constructor(context: StmtPrinterContext, original: ArkThrowStmt);
    transfer2ts(): void;
}
export declare class SourceTypeAliasStmt extends SourceStmt {
    aliasType: AliasType;
    constructor(context: StmtPrinterContext, original: Stmt, aliasType: AliasType);
    transfer2ts(): void;
    private generateClassTS;
}
export declare class SourceTryStmt extends SourceStmt {
    constructor(context: StmtPrinterContext, stmt: Stmt);
    transfer2ts(): void;
    protected afterDump(): void;
}
export declare class SourceCatchStmt extends SourceStmt {
    block: BasicBlock | undefined;
    constructor(context: StmtPrinterContext, stmt: Stmt, block?: BasicBlock);
    transfer2ts(): void;
    protected beforeDump(): void;
    protected afterDump(): void;
}
export declare class SourceFinallyStmt extends SourceStmt {
    constructor(context: StmtPrinterContext, stmt: Stmt);
    transfer2ts(): void;
    protected beforeDump(): void;
    protected afterDump(): void;
}
export declare class SourceNewArrayExpr {
    expr: ArkNewArrayExpr;
    values: string[];
    constructor(expr: ArkNewArrayExpr);
    addInitValue(value: string): void;
    toString(): string;
}
export declare function stmt2SourceStmt(context: StmtPrinterContext, stmt: Stmt): SourceStmt;
//# sourceMappingURL=SourceStmt.d.ts.map