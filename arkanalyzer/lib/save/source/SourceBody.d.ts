import { Local } from '../../core/base/Local';
import { Stmt } from '../../core/base/Stmt';
import { ArkMethod } from '../../core/model/ArkMethod';
import { ArkCodeBuffer } from '../ArkStream';
import { SourceStmt, StmtPrinterContext } from './SourceStmt';
import { ArkClass } from '../../core/model/ArkClass';
import { ArkFile } from '../../core/model/ArkFile';
import { ClassSignature, MethodSignature } from '../../core/model/ArkSignature';
import { ArkNamespace } from '../../core/model/ArkNamespace';
export declare class SourceBody implements StmtPrinterContext {
    protected printer: ArkCodeBuffer;
    private arkBody;
    private stmts;
    private method;
    private cfgUtils;
    private tempCodeMap;
    private tempVisitor;
    private skipStmts;
    private stmtReader;
    private definedLocals;
    private inBuilder;
    private lastStmt;
    constructor(indent: string, method: ArkMethod, inBuilder: boolean);
    setSkipStmt(stmt: Stmt): void;
    isInBuilderMethod(): boolean;
    isInDefaultMethod(): boolean;
    getArkFile(): ArkFile;
    getDeclaringArkNamespace(): ArkNamespace | undefined;
    getMethod(signature: MethodSignature): ArkMethod | null;
    getClass(signature: ClassSignature): ArkClass | null;
    getLocals(): Map<string, Local>;
    defineLocal(local: Local): void;
    isLocalDefined(local: Local): boolean;
    getStmtReader(): StmtReader;
    setTempCode(temp: string, code: string): void;
    transTemp2Code(temp: Local, isLeftOp?: boolean): string;
    getTempCodeMap(): Map<string, string>;
    hasTempVisit(temp: string): boolean;
    setTempVisit(temp: string): void;
    getPrinter(): ArkCodeBuffer;
    dump(): string;
    private buildSourceStmt;
    private buildBasicBlock;
    private printStmts;
    getStmts(): SourceStmt[];
    pushStmt(stmt: SourceStmt): void;
    private getLastLine;
    private sortStmt;
}
export declare class StmtReader {
    private stmts;
    private pos;
    constructor(stmts: Stmt[]);
    first(): Stmt;
    hasNext(): boolean;
    next(): Stmt;
    rollback(): void;
}
//# sourceMappingURL=SourceBody.d.ts.map