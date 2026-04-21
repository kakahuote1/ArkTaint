import { ImportInfo } from '../../core/model/ArkImport';
import { BasePrinter, Dump } from './BasePrinter';
export declare class ImportPrinter extends BasePrinter {
    infos: ImportInfo[];
    constructor(infos: ImportInfo[], indent?: string);
    getLine(): number;
    dump(): string;
}
export declare function printImports(imports: ImportInfo[], indent: string): Dump[];
//# sourceMappingURL=ImportPrinter.d.ts.map