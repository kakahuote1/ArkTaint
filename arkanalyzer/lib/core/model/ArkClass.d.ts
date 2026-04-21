import { GenericType, Type } from '../base/Type';
import { ViewTree } from '../graph/ViewTree';
import { ArkField } from './ArkField';
import { ArkFile, Language } from './ArkFile';
import { ArkMethod } from './ArkMethod';
import { ArkNamespace } from './ArkNamespace';
import { ClassSignature, FieldSignature, FileSignature, MethodSignature, NamespaceSignature } from './ArkSignature';
import { Local } from '../base/Local';
import { ArkExport, ExportType } from './ArkExport';
import { ArkBaseModel } from './ArkBaseModel';
import { ArkError } from '../common/ArkError';
export declare enum ClassCategory {
    CLASS = 0,
    STRUCT = 1,
    INTERFACE = 2,
    ENUM = 3,
    TYPE_LITERAL = 4,
    OBJECT = 5
}
/**
 * @category core/model
 */
export declare class ArkClass extends ArkBaseModel implements ArkExport {
    private category;
    private code?;
    private lineCol;
    private declaringArkFile;
    private declaringArkNamespace;
    private classSignature;
    /**
     * The keys of the `heritageClasses` map represent the names of superclass and interfaces.
     * The superclass name is placed first; if it does not exist, an empty string `''` will occupy this position.
     * The values of the `heritageClasses` map will be replaced with `ArkClass` or `null` during type inference.
     */
    private heritageClasses;
    private genericsTypes?;
    private realTypes?;
    private defaultMethod;
    private methods;
    private fields;
    private extendedClasses;
    private staticMethods;
    private staticFields;
    private instanceInitMethod;
    private staticInitMethod;
    private anonymousMethodNumber;
    private indexSignatureNumber;
    private viewTree?;
    constructor();
    /**
     * Returns the program language of the file where this class defined.
     */
    getLanguage(): Language;
    /**
     * Returns the **string**name of this class.
     * @returns The name of this class.
     */
    getName(): string;
    /**
     * Returns the codes of class as a **string.**
     * @returns the codes of class.
     */
    getCode(): string | undefined;
    setCode(code: string): void;
    /**
     * Returns the line position of this class.
     * @returns The line position of this class.
     */
    getLine(): number;
    setLine(line: number): void;
    /**
     * Returns the column position of this class.
     * @returns The column position of this class.
     */
    getColumn(): number;
    setColumn(column: number): void;
    getCategory(): ClassCategory;
    setCategory(category: ClassCategory): void;
    /**
     * Returns the declaring file.
     * @returns A file defined by ArkAnalyzer.
     * @example
     * 1. Get the {@link ArkFile} which the ArkClass is in.

     ```typescript
     const arkFile = arkClass.getDeclaringArkFile();
     ```
     */
    getDeclaringArkFile(): ArkFile;
    setDeclaringArkFile(declaringArkFile: ArkFile): void;
    /**
     * Returns the declaring namespace of this class, which may also be an **undefined**.
     * @returns The declaring namespace (may be **undefined**) of this class.
     */
    getDeclaringArkNamespace(): ArkNamespace | undefined;
    setDeclaringArkNamespace(declaringArkNamespace: ArkNamespace | undefined): void;
    isDefaultArkClass(): boolean;
    isAnonymousClass(): boolean;
    /**
     * Returns the signature of current class (i.e., {@link ClassSignature}).
     * The {@link ClassSignature} can uniquely identify a class, according to which we can find the class from the scene.
     * @returns The class signature.
     */
    getSignature(): ClassSignature;
    setSignature(classSig: ClassSignature): void;
    getSuperClassName(): string;
    addHeritageClassName(className: string): void;
    /**
     * Returns the superclass of this class.
     * @returns The superclass of this class.
     */
    getSuperClass(): ArkClass | null;
    private getHeritageClass;
    getAllHeritageClasses(): ArkClass[];
    getExtendedClasses(): Map<string, ArkClass>;
    addExtendedClass(extendedClass: ArkClass): void;
    getImplementedInterfaceNames(): string[];
    hasImplementedInterface(interfaceName: string): boolean;
    getImplementedInterface(interfaceName: string): ArkClass | null;
    /**
     * Get the field according to its field signature.
     * If no field cound be found, **null**will be returned.
     * @param fieldSignature - the field's signature.
     * @returns A field. If there is no field in this class, the return will be a **null**.
     */
    getField(fieldSignature: FieldSignature): ArkField | null;
    getFieldWithName(fieldName: string): ArkField | null;
    getStaticFieldWithName(fieldName: string): ArkField | null;
    /**
     * Returns an **array** of fields in the class.
     * @returns an **array** of fields in the class.
     */
    getFields(): ArkField[];
    addField(field: ArkField): void;
    addFields(fields: ArkField[]): void;
    getRealTypes(): Type[] | undefined;
    getGenericsTypes(): GenericType[] | undefined;
    addGenericType(gType: GenericType): void;
    /**
     * Returns all methods defined in the specific class in the form of an array.
     * @param generated - indicating whether this API returns the methods that are dynamically
     * generated at runtime. If it is not specified as true or false, the return will not include the generated method.
     * @returns An array of all methods in this class.
     * @example
     * 1. Get methods defined in class `BookService`.

     ```typescript
     let classes: ArkClass[] = scene.getClasses();
     let serviceClass : ArkClass = classes[1];
     let methods: ArkMethod[] = serviceClass.getMethods();
     let methodNames: string[] = methods.map(mthd => mthd.name);
     console.log(methodNames);
     ```
     */
    getMethods(generated?: boolean): ArkMethod[];
    getMethod(methodSignature: MethodSignature): ArkMethod | null;
    getMethodWithName(methodName: string): ArkMethod | null;
    getStaticMethodWithName(methodName: string): ArkMethod | null;
    /**
     * add a method in class.
     * when a nested method with declare name, add both the declare origin name and signature name
     * %${declare name}$${outer method name} in class.
     */
    addMethod(method: ArkMethod, originName?: string): void;
    /**
     * Update the new method to the corresponding Map.
     *
     * @param newMethod - the new method
     * @param methodName - name of new method
     */
    private updateMethodMap;
    /**
     * Get all non-static methods with the same name.
     *
     * @param methodName - name of method
     * @returns an **array** of methods in the class.
     */
    getMethodsWithName(methodName: string): ArkMethod[];
    /**
     * Get all static methods with the same name.
     *
     * @param methodName - name of method
     * @returns an **array** of methods in the class.
     */
    getStaticMethodsWithName(methodName: string): ArkMethod[];
    /**
     * Get all non-static and static methods with the same name.
     *
     * @param methodName - name of method
     * @returns an **array** of methods in the class.
     */
    getAllMethodsWithName(methodName: string): ArkMethod[];
    setDefaultArkMethod(defaultMethod: ArkMethod): void;
    getDefaultArkMethod(): ArkMethod | null;
    setViewTree(viewTree: ViewTree): void;
    /**
     * Returns the view tree of the ArkClass.
     * @returns The view tree of the ArkClass.
     * @example
     * 1. get viewTree of ArkClass.

     ```typescript
     for (let arkFiles of scene.getFiles()) {
     for (let arkClasss of arkFiles.getClasses()) {
     if (arkClasss.hasViewTree()) {
     arkClasss.getViewTree();
     }
     }
     }
     ```
     */
    getViewTree(): ViewTree | undefined;
    /**
     * Check whether the view tree is defined.
     * If it is defined, the return value is true, otherwise it is false.
     * @returns True if the view tree is defined; false otherwise.
     * @example
     * 1. Judge viewTree of ArkClass.

     ```typescript
     for (let arkFiles of scene.getFiles()) {
     for (let arkClasss of arkFiles.getClasses()) {
     if (arkClasss.hasViewTree()) {
     arkClasss.getViewTree();
     }
     }
     }
     ```
     */
    hasViewTree(): boolean;
    getStaticFields(classMap: Map<FileSignature | NamespaceSignature, ArkClass[]>): ArkField[];
    getGlobalVariable(globalMap: Map<FileSignature | NamespaceSignature, Local[]>): Local[];
    getAnonymousMethodNumber(): number;
    getIndexSignatureNumber(): number;
    getExportType(): ExportType;
    getInstanceInitMethod(): ArkMethod;
    getStaticInitMethod(): ArkMethod;
    setInstanceInitMethod(arkMethod: ArkMethod): void;
    setStaticInitMethod(arkMethod: ArkMethod): void;
    removeField(field: ArkField): boolean;
    removeMethod(method: ArkMethod): boolean;
    validate(): ArkError;
}
//# sourceMappingURL=ArkClass.d.ts.map