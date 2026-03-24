import { StmtValidator, SummaryReporter } from './Validator';
import { ArkAssignStmt } from '../../core/base/Stmt';
export declare class AssignStmtValidator extends StmtValidator<ArkAssignStmt> {
    private static readonly INSTANCE;
    validate(value: ArkAssignStmt, ctx: SummaryReporter): void;
}
//# sourceMappingURL=Stmts.d.ts.map