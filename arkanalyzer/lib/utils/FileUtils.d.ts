import { Language } from '../core/model/ArkFile';
export declare class FileUtils {
    static readonly FILE_FILTER: {
        ignores: string[];
        include: RegExp;
    };
    static getIndexFileName(srcPath: string): string;
    static isDirectory(srcPath: string): boolean;
    static isAbsolutePath(path: string): boolean;
    static generateModuleMap(ohPkgContentMap: Map<string, {
        [k: string]: unknown;
    }>): Map<string, ModulePath>;
    static getFileLanguage(file: string, fileTags?: Map<string, Language>): Language;
}
export declare class ModulePath {
    path: string;
    main: string;
    constructor(path: string, main: string);
}
export declare function getFileRecursively(srcDir: string, fileName: string, visited?: Set<string>): string;
//# sourceMappingURL=FileUtils.d.ts.map