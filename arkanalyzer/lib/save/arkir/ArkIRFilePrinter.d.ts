import { ArkFile } from '../../core/model/ArkFile';
import { Dump } from '../base/BasePrinter';
import { Printer } from '../Printer';
/**
 * @category save
 */
export declare class ArkIRFilePrinter extends Printer {
    arkFile: ArkFile;
    items: Dump[];
    constructor(arkFile: ArkFile);
    dump(): string;
}
//# sourceMappingURL=ArkIRFilePrinter.d.ts.map