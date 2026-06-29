import type { FrameworkModuleProvider } from "./FrameworkModuleProvider";
import type { SemanticEndpointProjection, SemanticEndpointProjectionInput } from "./PagNodeResolution";

export interface ModuleEndpointProjector {
    projectEndpoint(input: SemanticEndpointProjectionInput): SemanticEndpointProjection;
}

export interface ModuleExecutionAdapter<TRuleSet = unknown> {
    readonly endpointProjector?: ModuleEndpointProjector;
    toFrameworkModuleProviders(ruleSet: TRuleSet): FrameworkModuleProvider[];
}
