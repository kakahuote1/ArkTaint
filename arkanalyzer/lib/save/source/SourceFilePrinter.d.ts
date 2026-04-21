import { ArkFile } from '../../core/model/ArkFile';
import { Dump } from '../base/BasePrinter';
import { Printer } from '../Printer';
/**
 * @category save
 */
export declare class SourceFilePrinter extends Printer {
    arkFile: ArkFile;
    items: Dump[];
    constructor(arkFile: ArkFile);
    private printDefaultClassInFile;
    dump(): string;
}
//# sourceMappingURL=SourceFilePrinter.d.ts.map