import { ArkClass } from '../core/model/ArkClass';
import { ArkFile } from '../core/model/ArkFile';
import { ArkMethod } from '../core/model/ArkMethod';
import { ArkNamespace } from '../core/model/ArkNamespace';
import { Printer } from './Printer';
/**
 * @category save
 */
export declare class DotMethodPrinter extends Printer {
    method: ArkMethod;
    nesting: boolean;
    constructor(method: ArkMethod, nesting?: boolean);
    dump(): string;
    protected stringHashCode(name: string): number;
    private printBlocks;
    private getBlockContent;
}
/**
 * @category save
 */
export declare class DotClassPrinter extends Printer {
    cls: ArkClass;
    nesting: boolean;
    constructor(cls: ArkClass, nesting?: boolean);
    dump(): string;
}
/**
 * @category save
 */
export declare class DotNamespacePrinter extends Printer {
    ns: ArkNamespace;
    nesting: boolean;
    constructor(ns: ArkNamespace, nesting?: boolean);
    dump(): string;
}
/**
 * @category save
 */
export declare class DotFilePrinter extends Printer {
    arkFile: ArkFile;
    constructor(arkFile: ArkFile);
    dump(): string;
}
//# sourceMappingURL=DotPrinter.d.ts.map