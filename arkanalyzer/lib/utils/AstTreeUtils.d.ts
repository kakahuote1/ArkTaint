import { ArkFile, ts } from '..';
export declare class AstTreeUtils {
    /**
     * get source file from code segment
     * @param fileName source file name
     * @param code source code
     * @returns ts.SourceFile
     */
    static getASTNode(fileName: string, code: string): ts.SourceFile;
    /**
     * get source file from ArkFile
     * @param arkFile ArkFile
     * @returns ts.SourceFile
     */
    static getSourceFileFromArkFile(arkFile: ArkFile): ts.SourceFile;
    static createSourceFile(fileName: string, code: string): ts.SourceFile;
    /**
     * convert source code to hash string
     * @param code source code
     * @returns string
     */
    private static getKeyFromCode;
}
//# sourceMappingURL=AstTreeUtils.d.ts.map