import { AbstractExpr } from '../base/Expr';
import { Value } from '../base/Value';
/**
 * Replace old use of a Expr inplace
 */
export declare class ExprUseReplacer {
    private oldUse;
    private newUse;
    constructor(oldUse: Value, newUse: Value);
    caseExpr(expr: AbstractExpr): void;
    private caseBinopExpr;
    private caseInvokeExpr;
    private caseNewArrayExpr;
    private caseTypeOfExpr;
    private caseInstanceOfExpr;
    private caseCastExpr;
    private caseAwaitExpr;
    private caseDeleteExpr;
    private caseYieldExpr;
    private caseUnopExpr;
}
//# sourceMappingURL=ExprUseReplacer.d.ts.map