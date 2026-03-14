import { Local } from '../base/Local';
import { ArkClass } from '../model/ArkClass';
import { ArkFile, Language } from '../model/ArkFile';
import { ArkMethod } from '../model/ArkMethod';
import { ArkNamespace } from '../model/ArkNamespace';
import { ClassSignature, MethodSignature, Signature } from '../model/ArkSignature';
import { ArkExport, ExportInfo, FromInfo } from '../model/ArkExport';
import { ArkField } from '../model/ArkField';
import { ClassType, Type } from '../base/Type';
import { Scene } from '../../Scene';
import { ArkBaseModel } from '../model/ArkBaseModel';
import { MethodParameter } from '../model/builder/ArkMethodBuilder';
import { Value } from '../base/Value';
export declare class ModelUtils {
    static implicitArkUIBuilderMethods: Set<ArkMethod>;
    static dispose(): void;
    static getMethodSignatureFromArkClass(arkClass: ArkClass, methodName: string): MethodSignature | null;
    static getClassWithNameInNamespaceRecursively(className: string, ns: ArkNamespace): ArkClass | null;
    static getClassWithNameFromClass(className: string, startFrom: ArkClass): ArkClass | null;
    /**
     *  search class within the file that contain the given method
     */
    static getClassWithName(className: string, thisClass: ArkClass): ArkClass | null;
    /** search class within the given file */
    static getClassInFileWithName(className: string, arkFile: ArkFile): ArkClass | null;
    static getClassInImportInfoWithName(className: string, arkFile: ArkFile): ArkClass | null;
    /** search type within the given file import infos */
    static getArkExportInImportInfoWithName(name: string, arkFile: ArkFile): ArkExport | null;
    /** search method within the file that contain the given method */
    static getMethodWithName(methodName: string, startFrom: ArkMethod): ArkMethod | null;
    static getNamespaceWithNameFromClass(namespaceName: string, startFrom: ArkClass): ArkNamespace | null;
    static getNamespaceWithName(namespaceName: string, thisClass: ArkClass): ArkNamespace | null;
    static getNamespaceInFileWithName(namespaceName: string, arkFile: ArkFile): ArkNamespace | null;
    static findSymbolInFileWithName(symbolName: string, arkClass: ArkClass, onlyType?: boolean): ArkExport | null;
    static getNamespaceInImportInfoWithName(namespaceName: string, arkFile: ArkFile): ArkNamespace | null;
    static getStaticMethodWithName(methodName: string, thisClass: ArkClass): ArkMethod | null;
    static isLanguageOverloadSupport(language: Language): boolean;
    static getStaticMethodInFileWithName(methodName: string, arkFile: ArkFile): ArkMethod | null;
    static getStaticMethodInImportInfoWithName(methodName: string, arkFile: ArkFile): ArkMethod | null;
    static getLocalInImportInfoWithName(localName: string, arkFile: ArkFile): Local | null;
    static getAllNamespacesInFile(arkFile: ArkFile): ArkNamespace[];
    static getAllNamespacesInNamespace(arkNamespace: ArkNamespace, allNamespaces: ArkNamespace[]): void;
    static getAllClassesInFile(arkFile: ArkFile): ArkClass[];
    static getAllMethodsInFile(arkFile: ArkFile): ArkMethod[];
    static isArkUIBuilderMethod(arkMethod: ArkMethod): boolean;
    static getArkClassInBuild(scene: Scene, classType: ClassType): ArkClass | null;
    static getDefaultClass(arkClass: ArkClass): ArkClass | null;
    static getClass(method: ArkMethod, signature: ClassSignature): ArkClass | null;
    static findPropertyInNamespace(name: string, namespace: ArkNamespace): ArkExport | null | undefined;
    static findPropertyInClass(name: string, arkClass: ArkClass): ArkExport | ArkField | null;
    static findDeclaredLocal(local: Local, arkMethod: ArkMethod, times?: number): Local | null;
    static findArkModel(baseName: string, arkClass: ArkClass): ArkExport | ArkField | null;
    static findGlobalRef(refName: string, method: ArkMethod): ArkExport | null;
    static findArkModelByRefName(refName: string, arkClass: ArkClass): ArkExport | ArkField | null;
    static findArkModelBySignature(signature: Signature, scene: Scene): ArkExport | ArkField | null;
    static parseArkBaseModel2Type(arkBaseModel: ArkBaseModel): Type | null;
    static isMatched(parameters: MethodParameter[], args: Value[], scene: Scene, isArrowFunc?: boolean): boolean;
    private static matchParam;
    private static matchType;
    private static classTypeMatch;
    private static parseArg;
}
/**
 * find arkFile by from info
 * export xx from '../xx'
 * import xx from '@ohos/xx'
 * import xx from '@ohos.xx'
 * @param im importInfo or exportInfo
 */
export declare function getArkFile(im: FromInfo): ArkFile | null | undefined;
/**
 * find from info's export
 * @param fromInfo importInfo or exportInfo
 * @param visited
 */
export declare function findExportInfo(fromInfo: FromInfo, visited?: Set<ArkFile>): ExportInfo | null;
export declare function findArkExport(exportInfo: ExportInfo | undefined): ArkExport | null;
export declare function findArkExportInFile(name: string, declaringArkFile: ArkFile): ArkExport | null;
export declare function findExportInfoInfile(fromInfo: FromInfo, file: ArkFile, visited?: Set<ArkFile>): ExportInfo | undefined;
export declare function initModulePathMap(ohPkgContentMap: Map<string, {
    [k: string]: unknown;
}>): void;
