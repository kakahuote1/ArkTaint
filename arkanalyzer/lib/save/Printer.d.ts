import { ArkCodeBuffer } from './ArkStream';
/**
 * @category save
 */
export declare abstract class Printer {
    protected printer: ArkCodeBuffer;
    constructor(indent?: string);
    /**
     * ArkIR dump
     */
    abstract dump(): string;
}
//# sourceMappingURL=Printer.d.ts.map