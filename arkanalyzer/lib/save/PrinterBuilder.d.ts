import { ArkFile } from '../core/model/ArkFile';
import { Printer } from './Printer';
import { Scene } from '../Scene';
import { PrinterOptions } from './base/BasePrinter';
/**
 * @example
 * // dump method IR to ts source
 * let method: Method = xx;
 * let srcPrinter = new SourceMethodPrinter(method);
 * PrinterBuilder.dump(srcPrinter, 'output.ts');
 *
 *
 * // dump method cfg to dot
 * let dotPrinter = new DotMethodPrinter(method);
 * PrinterBuilder.dump(dotPrinter, 'output.dot');
 *
 * // dump project
 * let printer = new PrinterBuilder('output');
 * for (let f of scene.getFiles()) {
 *     printer.dumpToTs(f);
 * }
 *
 * @category save
 */
export declare class PrinterBuilder {
    outputDir: string;
    constructor(outputDir?: string);
    static dump(source: Printer, output: string): void;
    protected getOutputDir(arkFile: ArkFile): string;
    dumpToDot(arkFile: ArkFile, output?: string | undefined): void;
    dumpToTs(arkFile: ArkFile, output?: string | undefined): void;
    dumpToJson(arkFile: ArkFile, output?: string | undefined): void;
    dumpToIR(arkFile: ArkFile, output?: string | undefined): void;
}
/**
 * @example
 * // dump scene
 * let scenePrinter = new ScenePrinter(scene, 'output');
 * scenePrinter.dumpToTs();
 * scenePrinter.dumpToIR();
 *
 * @category save
 */
export declare class ScenePrinter {
    scene: Scene;
    outputDir: string;
    printer: PrinterBuilder;
    constructor(scene: Scene, outputDir: string, option?: PrinterOptions);
    dumpToDot(): void;
    dumpToTs(): void;
    dumpToJson(): void;
    dumpToIR(): void;
}
//# sourceMappingURL=PrinterBuilder.d.ts.map