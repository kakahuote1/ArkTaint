import { Decorator } from '../../core/base/Decorator';
import { ClassCategory } from '../../core/model/ArkClass';
import { CommentsMetadata } from '../../core/model/ArkMetadata';
import { Printer } from '../Printer';
export interface Dump {
    getLine(): number;
    dump(): string;
}
export interface PrinterOptions {
    pureTs: boolean;
    noMethodBody: boolean;
}
export declare function setPrinterOptions(options: PrinterOptions): void;
export declare abstract class BasePrinter extends Printer implements Dump {
    constructor(indent: string);
    abstract getLine(): number;
    protected printDecorator(docorator: Decorator[]): void;
    protected printComments(commentsMetadata: CommentsMetadata): void;
    protected modifiersToString(modifiers: number): string;
    protected resolveMethodName(name: string): string;
    protected classOriginTypeToString(clsCategory: ClassCategory): string;
    static getPrinterOptions(): PrinterOptions;
}
//# sourceMappingURL=BasePrinter.d.ts.map