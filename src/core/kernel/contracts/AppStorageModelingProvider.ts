import { Scene } from "../../../../arkanalyzer/out/src/Scene";
import { Pag } from "../../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import { FrameworkModelingPlugin } from "./FrameworkModelingPlugin";
import type { SemanticPackQueryApi } from "./SemanticPack";

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
    queries: SemanticPackQueryApi;
}

export interface AppStorageModelingProvider extends FrameworkModelingPlugin {
    readonly pluginId: "harmony.appstorage";
    buildAppStorageModel(args: BuildAppStorageSemanticModelArgs): AppStorageSemanticModel;
}
