import { ArkField } from '../../core/model/ArkField';
import { BasePrinter } from '../base/BasePrinter';
/**
 * @category save
 */
export declare class ArkIRFieldPrinter extends BasePrinter {
    private field;
    constructor(field: ArkField, indent?: string);
    getLine(): number;
    dump(): string;
}
//# sourceMappingURL=ArkIRFieldPrinter.d.ts.map