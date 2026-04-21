import { ArkExport, ExportInfo, ExportType } from './ArkExport';
import { ArkClass } from './ArkClass';
import { ArkFile, Language } from './ArkFile';
import { ArkMethod } from './ArkMethod';
import { ClassSignature, NamespaceSignature } from './ArkSignature';
import { ArkBaseModel } from './ArkBaseModel';
import { ArkError } from '../common/ArkError';
/**
 * @category core/model
 */
export declare class ArkNamespace extends ArkBaseModel implements ArkExport {
    private sourceCodes;
    private lineCols;
    private declaringArkFile;
    private declaringArkNamespace;
    private declaringInstance;
    private exportInfos;
    private defaultClass;
    private namespaces;
    private classes;
    private namespaceSignature;
    private anonymousClassNumber;
    constructor();
    /**
     * Returns the program language of the file where this namespace defined.
     */
    getLanguage(): Language;
    addNamespace(namespace: ArkNamespace): void;
    getNamespace(namespaceSignature: NamespaceSignature): ArkNamespace | null;
    getNamespaceWithName(namespaceName: string): ArkNamespace | null;
    getNamespaces(): ArkNamespace[];
    setSignature(namespaceSignature: NamespaceSignature): void;
    getSignature(): NamespaceSignature;
    getNamespaceSignature(): NamespaceSignature;
    getName(): string;
    getCode(): string;
    setCode(sourceCode: string): void;
    getCodes(): string[];
    setCodes(sourceCodes: string[]): void;
    addCode(sourceCode: string): void;
    getLine(): number;
    setLine(line: number): void;
    getColumn(): number;
    setColumn(column: number): void;
    getLineColPairs(): [number, number][];
    setLineCols(lineColPairs: [number, number][]): void;
    getDeclaringInstance(): ArkNamespace | ArkFile;
    setDeclaringInstance(declaringInstance: ArkFile | ArkNamespace): void;
    getDeclaringArkFile(): ArkFile;
    setDeclaringArkFile(declaringArkFile: ArkFile): void;
    getDeclaringArkNamespace(): ArkNamespace | null;
    setDeclaringArkNamespace(declaringArkNamespace: ArkNamespace): void;
    getClass(classSignature: ClassSignature): ArkClass | null;
    getClassWithName(Class: string): ArkClass | null;
    getClasses(): ArkClass[];
    addArkClass(arkClass: ArkClass, originName?: string): void;
    getExportInfos(): ExportInfo[];
    getExportInfoBy(name: string): ExportInfo | undefined;
    addExportInfo(exportInfo: ExportInfo): void;
    getDefaultClass(): ArkClass;
    setDefaultClass(defaultClass: ArkClass): void;
    getAllMethodsUnderThisNamespace(): ArkMethod[];
    getAllClassesUnderThisNamespace(): ArkClass[];
    getAllNamespacesUnderThisNamespace(): ArkNamespace[];
    getAnonymousClassNumber(): number;
    getExportType(): ExportType;
    removeArkClass(arkClass: ArkClass): boolean;
    removeNamespace(namespace: ArkNamespace): boolean;
    validate(): ArkError;
}
//# sourceMappingURL=ArkNamespace.d.ts.map