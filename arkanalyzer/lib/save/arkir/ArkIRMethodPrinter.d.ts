import { ArkMethod } from '../../core/model/ArkMethod';
import { BasePrinter } from '../base/BasePrinter';
/**
 * @category save
 */
export declare class ArkIRMethodPrinter extends BasePrinter {
    private method;
    constructor(method: ArkMethod, indent?: string);
    dump(): string;
    getLine(): number;
    private printMethod;
    private printBody;
    protected methodProtoToString(method: ArkMethod): string;
    private printCfg;
    private printBasicBlock;
}
//# sourceMappingURL=ArkIRMethodPrinter.d.ts.map