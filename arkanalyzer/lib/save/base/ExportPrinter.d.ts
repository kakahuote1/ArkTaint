import { ExportInfo } from '../../core/model/ArkExport';
import { BasePrinter } from './BasePrinter';
export declare class ExportPrinter extends BasePrinter {
    info: ExportInfo;
    constructor(info: ExportInfo, indent?: string);
    getLine(): number;
    dump(): string;
}
//# sourceMappingURL=ExportPrinter.d.ts.map