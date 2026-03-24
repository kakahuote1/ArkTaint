import { ArkNamespace } from '../../core/model/ArkNamespace';
import { BasePrinter } from '../base/BasePrinter';
/**
 * @category save
 */
export declare class ArkIRNamespacePrinter extends BasePrinter {
    ns: ArkNamespace;
    constructor(ns: ArkNamespace, indent?: string);
    getLine(): number;
    dump(): string;
}
//# sourceMappingURL=ArkIRNamespacePrinter.d.ts.map