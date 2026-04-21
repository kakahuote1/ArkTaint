import { Stmt } from '../base/Stmt';
import { Value } from '../base/Value';
/**
 * Replace old use(Value) of a Stmt inplace
 */
export declare class StmtUseReplacer {
    private oldUse;
    private newUse;
    constructor(oldUse: Value, newUse: Value);
    caseStmt(stmt: Stmt): void;
    private caseAssignStmt;
    private caseInvokeStmt;
    private caseReturnStmt;
    private caseIfStmt;
    private caseThrowStmt;
}
//# sourceMappingURL=StmtUseReplacer.d.ts.map