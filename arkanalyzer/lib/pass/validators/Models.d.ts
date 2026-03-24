import { ArkClass } from '../../core/model/ArkClass';
import { ClassValidator, FileValidator, MethodValidator, SummaryReporter } from './Validator';
import { ArkFile } from '../../core/model/ArkFile';
import { ArkMethod } from '../../core/model/ArkMethod';
export declare class ArkMethodValidator extends MethodValidator {
    validate(mtd: ArkMethod, ctx: SummaryReporter): void;
}
export declare class ArkClassValidator extends ClassValidator {
    validate(cls: ArkClass, ctx: SummaryReporter): void;
}
export declare class ArkFileValidator extends FileValidator {
    validate(file: ArkFile, ctx: SummaryReporter): void;
}
//# sourceMappingURL=Models.d.ts.map