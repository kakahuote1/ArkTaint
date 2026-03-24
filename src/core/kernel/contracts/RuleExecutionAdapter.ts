import { FrameworkModelingPlugin } from "./FrameworkModelingPlugin";

export interface RuleExecutionAdapter<TRuleSet = unknown> {
    toFrameworkModelingPlugins(ruleSet: TRuleSet): FrameworkModelingPlugin[];
}
