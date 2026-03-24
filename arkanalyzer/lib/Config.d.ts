import { Language } from './core/model/ArkFile';
export interface Sdk {
    name: string;
    path: string;
    moduleName: string;
}
export interface TsConfig {
    extends?: string;
    compilerOptions?: {
        baseUrl?: string;
        paths?: {
            [key: string]: string[];
        };
    };
}
export type SceneOptionsValue = string | number | boolean | (string | number)[] | string[] | null | undefined;
export interface SceneOptions {
    supportFileExts?: string[];
    ignoreFileNames?: string[];
    enableLeadingComments?: boolean;
    enableTrailingComments?: boolean;
    enableBuiltIn?: boolean;
    tsconfig?: string;
    isScanAbc?: boolean;
    sdkGlobalFolders?: string[];
    [option: string]: SceneOptionsValue;
}
export declare class SceneConfig {
    private targetProjectName;
    private targetProjectDirectory;
    private etsSdkPath;
    private sdksObj;
    private sdkFiles;
    private sdkFilesMap;
    private projectFiles;
    private fileLanguages;
    private options;
    constructor(options?: SceneOptions);
    getOptions(): SceneOptions;
    /**
     * Set the scene's config,
     * such as  the target project's name, the used sdks and the full path.
     * @param targetProjectName - the target project's name.
     * @param targetProjectDirectory - the target project's directory.
     * @param sdks - sdks used in this scene.
     * @param fullFilePath - the full file path.
     */
    buildConfig(targetProjectName: string, targetProjectDirectory: string, sdks: Sdk[], fullFilePath?: string[]): void;
    /**
     * Create a sceneConfig object for a specified project path and set the target project directory to the
     * targetProjectDirectory property of the sceneConfig object.
     * @param targetProjectDirectory - the target project directory, such as xxx/xxx/xxx, started from project
     *     directory.
     * @example
     * 1. build a sceneConfig object.
    ```typescript
    const projectDir = 'xxx/xxx/xxx';
    const sceneConfig: SceneConfig = new SceneConfig();
    sceneConfig.buildFromProjectDir(projectDir);
    ```
     */
    buildFromProjectDir(targetProjectDirectory: string): void;
    buildFromProjectFiles(projectName: string, projectDir: string, filesAndDirectorys: string[], sdks?: Sdk[], languageTags?: Map<string, Language>): void;
    private processFilePaths;
    private setLanguageTagForFiles;
    buildFromJson(configJsonPath: string): void;
    getTargetProjectName(): string;
    getTargetProjectDirectory(): string;
    getProjectFiles(): string[];
    getFileLanguages(): Map<string, Language>;
    getSdkFiles(): string[];
    getSdkFilesMap(): Map<string[], string>;
    getEtsSdkPath(): string;
    getSdksObj(): Sdk[];
    private getDefaultConfigPath;
    private loadDefaultConfig;
}
//# sourceMappingURL=Config.d.ts.map