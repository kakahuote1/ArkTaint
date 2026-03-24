import { Value } from '../base/Value';
import { Stmt } from '../base/Stmt';
/**
 * Replace old def(Value) of a Stmt inplace
 */
export declare class StmtDefReplacer {
    private oldDef;
    private newDef;
    constructor(oldDef: Value, newDef: Value);
    caseStmt(stmt: Stmt): void;
    private caseAssignStmt;
}
//# sourceMappingURL=StmtDefReplacer.d.ts.map