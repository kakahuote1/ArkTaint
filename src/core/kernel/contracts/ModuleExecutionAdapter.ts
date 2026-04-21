import type { FrameworkModuleProvider } from "./FrameworkModuleProvider";

export interface ModuleExecutionAdapter<TRuleSet = unknown> {
    toFrameworkModuleProviders(ruleSet: TRuleSet): FrameworkModuleProvider[];
}
