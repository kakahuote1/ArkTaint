import { ArkFile } from '../..';
import { Printer } from '../Printer';
export declare class JsonPrinter extends Printer {
    private arkFile;
    constructor(arkFile: ArkFile);
    dump(): string;
}
