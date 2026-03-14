import { SceneConfig, SceneOptions, Sdk } from './Config';
import { VisibleValue } from './core/common/VisibleValue';
import { ArkClass } from './core/model/ArkClass';
import { ArkFile, Language } from './core/model/ArkFile';
import { ArkMethod } from './core/model/ArkMethod';
import { ArkNamespace } from './core/model/ArkNamespace';
import { ClassSignature, FileSignature, MethodSignature, NamespaceSignature } from './core/model/ArkSignature';
import { Local } from './core/base/Local';
import { ArkExport } from './core/model/ArkExport';
import { CallGraph } from './callgraph/model/CallGraph';
declare enum SceneBuildStage {
    BUILD_INIT = 0,
    SDK_INFERRED = 1,
    CLASS_DONE = 2,
    METHOD_DONE = 3,
    CLASS_COLLECTED = 4,
    METHOD_COLLECTED = 5,
    TYPE_INFERRED = 6
}
/**
 * The Scene class includes everything in the analyzed project.
 * We should be able to re-generate the project's code based on this class.
 */
export declare class Scene {
    private projectName;
    private projectFiles;
    private realProjectDir;
    private moduleScenesMap;
    private modulePath2NameMap;
    private moduleSdkMap;
    private projectSdkMap;
    private visibleValue;
    private filesMap;
    private namespacesMap;
    private classesMap;
    private methodsMap;
    private sdkArkFilesMap;
    private sdkGlobalMap;
    private ohPkgContentMap;
    private ohPkgFilePath;
    private ohPkgContent;
    private overRides;
    private overRideDependencyMap;
    private globalModule2PathMapping?;
    private baseUrl?;
    private buildStage;
    private fileLanguages;
    private options;
    private unhandledFilePaths;
    private unhandledSdkFilePaths;
    constructor();
    dispose(): void;
    getOptions(): SceneOptions;
    getOverRides(): Map<string, string>;
    getOverRideDependencyMap(): Map<string, unknown>;
    clear(): void;
    getStage(): SceneBuildStage;
    /**
     * Build scene object according to the {@link SceneConfig}. This API implements 3 functions.
     * First is to build scene object from {@link SceneConfig}, second is to generate {@link ArkFile}s,
     * and the last is to collect project import infomation.
     * @param sceneConfig - a sceneConfig object, which is usally defined by user or Json file.
     * @example
     * 1. Build Scene object from scene config

     ```typescript
     // build config
     const projectDir = ... ...;
     const sceneConfig = new SceneConfig();
     sceneConfig.buildFromProjectDir(projectDir);

     // build scene
     const scene = new Scene();
     scene.buildSceneFromProjectDir(sceneConfig);
     ```
     */
    buildSceneFromProjectDir(sceneConfig: SceneConfig): void;
    buildSceneFromFiles(sceneConfig: SceneConfig): void;
    /**
     * Set the basic information of the scene using a config,
     * such as the project's name, real path and files.
     * @param sceneConfig - the config used to set the basic information of scene.
     */
    buildBasicInfo(sceneConfig: SceneConfig): void;
    private parseBuildProfile;
    private parseOhPackage;
    private findTsConfigInfoDeeply;
    private addTsConfigInfo;
    private updateOrAddDefaultConstructors;
    private buildAllMethodBody;
    private genArkFiles;
    private getFilesOrderByDependency;
    private getDependencyFilesDeeply;
    private isRepeatBuildFile;
    private addArkFile2ModuleScene;
    private findDependencyFiles;
    private parseFrom;
    private findDependenciesByTsConfig;
    private parseTsConfigParms;
    private processFuzzyMapping;
    private findDependenciesByRule;
    private findFilesByPathArray;
    private findFilesByExtNameArray;
    private findRelativeDependenciesByOhPkg;
    private findDependenciesByOhPkg;
    private getDependenciesMapping;
    private getOriginPath;
    private addFileNode2DependencyGrap;
    private buildSdk;
    /**
     * Build the scene for harmony project. It resolves the file path of the project first, and then fetches
     * dependencies from this file. Next, build a `ModuleScene` for this project to generate {@link ArkFile}. Finally,
     * it build bodies of all methods, generate extended classes, and add DefaultConstructors.
     */
    buildScene4HarmonyProject(): void;
    private buildOhPkgContentMap;
    buildModuleScene(moduleName: string, modulePath: string, supportFileExts: string[]): void;
    private processModuleOhPkgContent;
    /**
     * Get the absolute path of current project.
     * @returns The real project's directiory.
     * @example
     * 1. get real project directory, such as:
     ```typescript
     let projectDir = projectScene.getRealProjectDir();
     ```
     */
    getRealProjectDir(): string;
    /**
     * Returns the **string** name of the project.
     * @returns The name of the project.
     */
    getProjectName(): string;
    getProjectFiles(): string[];
    getSdkGlobal(globalName: string): ArkExport | null;
    /**
     * Returns the file based on its signature.
     * If no file can be found according to the input signature, **null** will be returned.
     * A typical {@link ArkFile} contains: file's name (i.e., its relative path), project's name,
     * project's dir, file's signature etc.
     * @param fileSignature - the signature of file.
     * @returns a file defined by ArkAnalyzer. **null** will be returned if no file could be found.
     * @example
     * 1. get ArkFile based on file signature.

     ```typescript
     if (...) {
     const fromSignature = new FileSignature();
     fromSignature.setProjectName(im.getDeclaringArkFile().getProjectName());
     fromSignature.setFileName(fileName);
     return scene.getFile(fromSignature);
     }
     ```
     */
    getFile(fileSignature: FileSignature): ArkFile | null;
    getUnhandledFilePaths(): string[];
    getUnhandledSdkFilePaths(): string[];
    setFile(file: ArkFile): void;
    hasSdkFile(fileSignature: FileSignature): boolean;
    /**
     * Get files of a {@link Scene}. Generally, a project includes several ets/ts files that define the different
     * class. We need to generate {@link ArkFile} objects from these ets/ts files.
     * @returns The array of {@link ArkFile} from `scene.filesMap.values()`.
     * @example
     * 1. In inferSimpleTypes() to check arkClass and arkMethod.
     * ```typescript
     * public inferSimpleTypes(): void {
     *   for (let arkFile of this.getFiles()) {
     *       for (let arkClass of arkFile.getClasses()) {
     *           for (let arkMethod of arkClass.getMethods()) {
     *           // ... ...;
     *           }
     *       }
     *   }
     * }
     * ```
     * 2. To iterate each method
     * ```typescript
     * for (const file of this.getFiles()) {
     *     for (const cls of file.getClasses()) {
     *         for (const method of cls.getMethods()) {
     *             // ... ...
     *         }
     *     }
     * }
     *```
     */
    getFiles(): ArkFile[];
    getFileLanguages(): Map<string, Language>;
    getSdkArkFiles(): ArkFile[];
    getModuleSdkMap(): Map<string, Sdk[]>;
    getProjectSdkMap(): Map<string, Sdk>;
    getNamespace(namespaceSignature: NamespaceSignature): ArkNamespace | null;
    private getNamespaceBySignature;
    private getNamespacesMap;
    getNamespaces(): ArkNamespace[];
    /**
     * Returns the class according to the input class signature.
     * @param classSignature - signature of the class to be obtained.
     * @returns A class.
     */
    getClass(classSignature: ClassSignature): ArkClass | null;
    private getClassesMap;
    getClasses(): ArkClass[];
    getMethod(methodSignature: MethodSignature, refresh?: boolean): ArkMethod | null;
    private getMethodsMap;
    /**
     * Returns the method associated with the method signature.
     * If no method is associated with this signature, **null** will be returned.
     * An {@link ArkMethod} includes:
     * - Name: the **string** name of method.
     * - Code: the **string** code of the method.
     * - Line: a **number** indicating the line location, initialized as -1.
     * - Column: a **number** indicating the column location, initialized as -1.
     * - Parameters & Types of parameters: the parameters of method and their types.
     * - View tree: the view tree of the method.
     * - ...
     *
     * @param methodSignature - the signature of method.
     * @returns The method associated with the method signature.
     * @example
     * 1. get method from getMethod.

     ```typescript
     const methodSignatures = this.CHA.resolveCall(xxx, yyy);
     for (const methodSignature of methodSignatures) {
     const method = this.scene.getMethod(methodSignature);
     ... ...
     }
     ```
     */
    getMethods(): ArkMethod[];
    addToMethodsMap(method: ArkMethod): void;
    removeMethod(method: ArkMethod): boolean;
    removeClass(arkClass: ArkClass): boolean;
    removeNamespace(namespace: ArkNamespace): boolean;
    removeFile(file: ArkFile): boolean;
    hasMainMethod(): boolean;
    getEntryPoints(): MethodSignature[];
    /** get values that is visible in curr scope */
    getVisibleValue(): VisibleValue;
    getOhPkgContent(): {
        [p: string]: unknown;
    };
    getOhPkgContentMap(): Map<string, {
        [p: string]: unknown;
    }>;
    getOhPkgFilePath(): string;
    makeCallGraphCHA(entryPoints: MethodSignature[]): CallGraph;
    makeCallGraphRTA(entryPoints: MethodSignature[]): CallGraph;
    /**
     * Infer type for each non-default method. It infers the type of each field/local/reference.
     * For example, the statement `let b = 5;`, the type of local `b` is `NumberType`; and for the statement `let s =
     * 'hello';`, the type of local `s` is `StringType`. The detailed types are defined in the Type.ts file.
     * @example
     * 1. Infer the type of each class field and method field.
     ```typescript
     const scene = new Scene();
     scene.buildSceneFromProjectDir(sceneConfig);
     scene.inferTypes();
     ```
     */
    inferTypes(): void;
    /**
     * @deprecated This method is deprecated and will be removed in the next major release.
     * Please use the new type inference system instead.
     *
     * Scheduled for removal: one month from deprecation date.
     */
    inferTypesOld(): void;
    /**
     * Iterate all assignment statements in methods,
     * and set the type of left operand based on the type of right operand
     * if the left operand is a local variable as well as an unknown.
     * @Deprecated
     * @example
     * 1. Infer simple type when scene building.

     ```typescript
     let scene = new Scene();
     scene.buildSceneFromProjectDir(config);
     scene.inferSimpleTypes();
     ```
     */
    inferSimpleTypes(): void;
    private addNSClasses;
    private addNSExportedClasses;
    private addFileImportedClasses;
    getClassMap(): Map<FileSignature | NamespaceSignature, ArkClass[]>;
    private addNSLocals;
    private addNSExportedLocals;
    private addFileImportLocals;
    private handleNestedNSLocals;
    getGlobalVariableMap(): Map<FileSignature | NamespaceSignature, Local[]>;
    getStaticInitMethods(): ArkMethod[];
    buildClassDone(): boolean;
    getModuleScene(moduleName: string): ModuleScene | undefined;
    getModuleSceneMap(): Map<string, ModuleScene>;
    getGlobalModule2PathMapping(): {
        [k: string]: string[];
    } | undefined;
    getbaseUrl(): string | undefined;
}
export declare class ModuleScene {
    private projectScene;
    private moduleName;
    private modulePath;
    private moduleFileMap;
    private moduleOhPkgFilePath;
    private ohPkgContent;
    constructor(projectScene: Scene);
    ModuleSceneBuilder(moduleName: string, modulePath: string, supportFileExts: string[], recursively?: boolean): void;
    ModuleScenePartiallyBuilder(moduleName: string, modulePath: string): void;
    /**
     * get oh-package.json5
     */
    private getModuleOhPkgFilePath;
    /**
     * get nodule name
     * @returns return module name
     */
    getModuleName(): string;
    getModulePath(): string;
    getOhPkgFilePath(): string;
    getOhPkgContent(): {
        [p: string]: unknown;
    };
    getModuleFilesMap(): Map<string, ArkFile>;
    addArkFile(arkFile: ArkFile): void;
    private genArkFiles;
}
export {};
