import { ArkClass } from '../../core/model/ArkClass';
import { SourceBase } from './SourceBase';
import { ArkNamespace } from '../../core/model/ArkNamespace';
import { Dump } from '../base/BasePrinter';
/**
 * @category save
 */
export declare class SourceClass extends SourceBase {
    protected cls: ArkClass;
    private transformer;
    constructor(cls: ArkClass, indent?: string);
    getDeclaringArkNamespace(): ArkNamespace | undefined;
    getLine(): number;
    dump(): string;
    private dumpObject;
    private dumpTypeLiteral;
    protected printMethods(): Dump[];
    private printFields;
    private parseFieldInitMethod;
}
export declare class SourceDefaultClass extends SourceClass {
    constructor(cls: ArkClass, indent?: string);
    getLine(): number;
    dump(): string;
}
//# sourceMappingURL=SourceClass.d.ts.map