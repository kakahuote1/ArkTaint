import type { Scene } from "../../../../arkanalyzer/out/src/Scene";
import type { Pag } from "../../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import type { FrameworkModuleProvider } from "./FrameworkModuleProvider";
import type { ModuleAnalysisApi, ModuleScanApi } from "./ModuleContract";

export interface AppStorageFieldEndpoint {
    objectNodeId: number;
    fieldName: string;
}

export interface AppStorageDynamicKeyWarning {
    methodSignature: string;
    callSignature: string;
    apiName: string;
    keyExprText: string;
}

export interface AppStorageSemanticModel {
    writeNodeIdsByKey: Map<string, Set<number>>;
    writeFieldNodeIdsByKey: Map<string, Set<number>>;
    writeFieldEndpointsByKey: Map<string, AppStorageFieldEndpoint[]>;
    readNodeIdsByKey: Map<string, Set<number>>;
    readFieldEndpointsByKey: Map<string, AppStorageFieldEndpoint[]>;
    readFieldNodeIdsByKey: Map<string, Set<number>>;
    dynamicKeyWarnings: AppStorageDynamicKeyWarning[];
}

export interface BuildAppStorageSemanticModelArgs {
    scene: Scene;
    pag: Pag;
    allowedMethodSignatures?: Set<string>;
    analysis: ModuleAnalysisApi;
    scan: ModuleScanApi;
}

export interface AppStorageModuleProvider extends FrameworkModuleProvider {
    readonly pluginId: "harmony.appstorage";
    buildAppStorageModel(args: BuildAppStorageSemanticModelArgs): AppStorageSemanticModel;
}
