import { ArkClass } from '../../core/model/ArkClass';
import { BasePrinter, Dump } from '../base/BasePrinter';
/**
 * @category save
 */
export declare class ArkIRClassPrinter extends BasePrinter {
    protected cls: ArkClass;
    constructor(cls: ArkClass, indent?: string);
    getLine(): number;
    dump(): string;
    protected printMethods(): Dump[];
    private printFields;
}
//# sourceMappingURL=ArkIRClassPrinter.d.ts.map