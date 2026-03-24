import { AbstractInvokeExpr } from '../../core/base/Expr';
import { SummaryReporter, ValueValidator } from './Validator';
import { Value } from '../../core/base/Value';
export declare class AbsInvokeValidator extends ValueValidator<AbstractInvokeExpr> {
    private static readonly INSTANCE;
    validate(value: AbstractInvokeExpr, ctx: SummaryReporter): void;
    checkArg(arg: Value, index: number, ctx: SummaryReporter): void;
}
//# sourceMappingURL=Exprs.d.ts.map