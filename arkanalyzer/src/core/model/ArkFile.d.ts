import { ModuleScene, Scene } from '../../Scene';
import { ExportInfo } from './ArkExport';
import { ImportInfo } from './ArkImport';
import { ArkClass } from './ArkClass';
import { ArkNamespace } from './ArkNamespace';
import { ClassSignature, FileSignature, NamespaceSignature } from './ArkSignature';
import { ts } from '../../index';
export declare const notStmtOrExprKind: string[];
export declare enum Language {
    TYPESCRIPT = 0,
    ARKTS1_1 = 1,
    ARKTS1_2 = 2,
    JAVASCRIPT = 3,
    CXX = 4,
    ABC = 5,
    UNKNOWN = -1
}
/**
 * @category core/model
 */
export declare class ArkFile {
    private language;
    private absoluteFilePath;
    private projectDir;
    private code;
    private defaultClass;
    private namespaces;
    private classes;
    private importInfoMap;
    private exportInfoMap;
    private scene;
    private moduleScene?;
    private fileSignature;
    private ohPackageJson5Path;
    private anonymousClassNumber;
    private ast;
    constructor(language: Language);
    /**
     * Returns the program language of the file.
     */
    getLanguage(): Language;
    setLanguage(language: Language): void;
    /**
     * Returns the **string** name of the file, which also acts as the file's relative path.
     * @returns The file's name (also means its relative path).
     */
    getName(): string;
    setScene(scene: Scene): void;
    /**
     * Returns the scene (i.e., {@link Scene}) built for the project. The {@link Scene} is the core class of ArkAnalyzer,
     * through which users can access all the information of the analyzed code (project),
     * including file list, class list, method list, property list, etc.
     * @returns The scene of the file.
     */
    getScene(): Scene;
    getModuleScene(): ModuleScene | undefined;
    setModuleScene(moduleScene: ModuleScene): void;
    setProjectDir(projectDir: string): void;
    getProjectDir(): string;
    /**
     * Get a file path.
     * @returns The absolute file path.
     * @example
     * 1. Read source code based on file path.

     ```typescript
     let str = fs.readFileSync(arkFile.getFilePath(), 'utf8');
     ```
     */
    getFilePath(): string;
    setFilePath(absoluteFilePath: string): void;
    setCode(code: string): void;
    /**
     * Returns the codes of file as a **string.**
     * @returns the codes of file.
     */
    getCode(): string;
    addArkClass(arkClass: ArkClass, originName?: string): void;
    getDefaultClass(): ArkClass;
    setDefaultClass(defaultClass: ArkClass): void;
    getNamespace(namespaceSignature: NamespaceSignature): ArkNamespace | null;
    getNamespaceWithName(namespaceName: string): ArkNamespace | null;
    getNamespaces(): ArkNamespace[];
    /**
     * Returns the class based on its class signature. If the class could not be found, **null** will be returned.
     * @param classSignature - the class signature.
     * @returns A class. If there is no class, the return will be a **null**.
     */
    getClass(classSignature: ClassSignature): ArkClass | null;
    getClassWithName(className: string): ArkClass | null;
    private findClassInNamespace;
    getClasses(): ArkClass[];
    addNamespace(namespace: ArkNamespace): void;
    /**
     * Returns an **array** of import information.
     * The import information includes: clause's name, type, modifiers, location where it is imported from, etc.
     * @returns An **array** of import information.
     */
    getImportInfos(): ImportInfo[];
    getImportInfoBy(name: string): ImportInfo | undefined;
    addImportInfo(importInfo: ImportInfo): void;
    removeImportInfo(importInfo: ImportInfo): boolean;
    removeNamespace(namespace: ArkNamespace): boolean;
    removeArkClass(arkClass: ArkClass): boolean;
    getExportInfos(): ExportInfo[];
    /**
     * Find out the {@link ExportInfo} of this {@link ArkFile} by the given export name.
     * It returns an {@link ExportInfo} or 'undefined' if it failed to find.
     * @param name
     * @returns
     * @example
     ```typescript
     // abc.ts ArkFile
     export class A {
     ...
     }

     export namespace B {
     export namespace C {
     export class D {}
     }
     }

     // xyz.ts call getExportInfoBy
     let arkFile = scene.getFile(fileSignature);

     // a is the export class A defined in abc.ts
     let a = arkFile.getExportInfoBy('A');

     // b is the export class D within namespace C defined in abc.ts
     let b = arkFile.getExportInfoBy('B.C.D');
     ```
     */
    getExportInfoBy(name: string): ExportInfo | undefined;
    addExportInfo(exportInfo: ExportInfo, key?: string): void;
    removeExportInfo(exportInfo: ExportInfo, key?: string): void;
    getProjectName(): string;
    getModuleName(): string | undefined;
    setOhPackageJson5Path(ohPackageJson5Path: string[]): void;
    getOhPackageJson5Path(): string[];
    /**
     * Returns the file signature of this file. A file signature consists of project's name and file's name.
     * @returns The file signature of this file.
     */
    getFileSignature(): FileSignature;
    setFileSignature(fileSignature: FileSignature): void;
    getAllNamespacesUnderThisFile(): ArkNamespace[];
    getAnonymousClassNumber(): number;
    getAST(): ts.SourceFile | null;
    setAST(value: ts.SourceFile | null): void;
}
