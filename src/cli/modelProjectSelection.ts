import type { RuleLoaderOptions } from "../core/rules/RuleLoader";
import { inspectRulePacks } from "../core/rules/RuleLoader";
import { inspectModules } from "../core/orchestration/modules/ModuleLoader";
import { inspectArkMainProjects } from "../core/entry/arkmain/ArkMainLoader";

export interface ResolveModelProjectSelectionsOptions {
    ruleOptions: RuleLoaderOptions;
    moduleRoots?: string[];
    enabledModuleProjects?: string[];
    disabledModuleProjects?: string[];
    arkMainRoots?: string[];
    enabledArkMainProjects?: string[];
    disabledArkMainProjects?: string[];
    enabledModelProjects?: string[];
    disabledModelProjects?: string[];
}

export interface ResolvedModelProjectSelections {
    ruleOptions: RuleLoaderOptions;
    enabledModuleProjects: string[];
    disabledModuleProjects: string[];
    enabledArkMainProjects: string[];
    disabledArkMainProjects: string[];
}

export interface ModelProjectInspectResult {
    discoveredRulePacks: string[];
    discoveredModuleProjects: string[];
    discoveredArkMainProjects: string[];
    enabledModelProjects: string[];
    warnings: string[];
}

export function resolveModelProjectSelections(
    options: ResolveModelProjectSelectionsOptions,
): ResolvedModelProjectSelections {
    const enabledModelProjects = normalizeIds(options.enabledModelProjects);
    const disabledModelProjects = normalizeIds(options.disabledModelProjects);
    const disabledModelSet = new Set(disabledModelProjects);

    const explicitEnabledRulePacks = normalizeIds(options.ruleOptions.enabledRulePacks);
    const explicitDisabledRulePacks = normalizeIds(options.ruleOptions.disabledRulePacks);
    const rulePackInspect = inspectRulePacks(options.ruleOptions);
    const discoveredRulePackSet = new Set(rulePackInspect.discoveredRulePacks);
    const enabledRulePacks = [...new Set([
        ...explicitEnabledRulePacks,
        ...enabledModelProjects.filter(projectId => discoveredRulePackSet.has(projectId)),
    ])].filter(projectId =>
        !explicitDisabledRulePacks.includes(projectId)
        && !disabledModelSet.has(projectId),
    );
    const disabledRulePacks = [...new Set([
        ...explicitDisabledRulePacks,
        ...disabledModelProjects,
    ])];

    const enabledModuleProjects = [...new Set([
        ...normalizeIds(options.enabledModuleProjects),
        ...enabledModelProjects,
    ])].filter(projectId => !disabledModelSet.has(projectId));
    const disabledModuleProjects = [...new Set([
        ...normalizeIds(options.disabledModuleProjects),
        ...disabledModelProjects,
    ])];

    const enabledArkMainProjects = [...new Set([
        ...normalizeIds(options.enabledArkMainProjects),
        ...enabledModelProjects,
    ])].filter(projectId => !disabledModelSet.has(projectId));
    const disabledArkMainProjects = [...new Set([
        ...normalizeIds(options.disabledArkMainProjects),
        ...disabledModelProjects,
    ])];

    return {
        ruleOptions: {
            ...options.ruleOptions,
            enabledRulePacks,
            disabledRulePacks,
        },
        enabledModuleProjects,
        disabledModuleProjects,
        enabledArkMainProjects,
        disabledArkMainProjects,
    };
}

export function inspectModelProjects(
    options: ResolveModelProjectSelectionsOptions,
): ModelProjectInspectResult {
    const ruleInspection = inspectRulePacks(options.ruleOptions);
    const moduleInspection = inspectModules({
        moduleRoots: options.moduleRoots || [],
        includeBuiltinModules: true,
        enabledModuleProjects: [],
        disabledModuleProjects: [],
    });
    const arkMainInspection = inspectArkMainProjects({
        arkMainRoots: options.arkMainRoots || [],
        includeBuiltinArkMain: true,
        enabledArkMainProjects: [],
        disabledArkMainProjects: [],
    });
    const enabledModelProjects = normalizeIds(options.enabledModelProjects)
        .filter(projectId => !normalizeIds(options.disabledModelProjects).includes(projectId));
    return {
        discoveredRulePacks: ruleInspection.discoveredRulePacks,
        discoveredModuleProjects: moduleInspection.discoveredModuleProjects,
        discoveredArkMainProjects: arkMainInspection.discoveredArkMainProjects,
        enabledModelProjects,
        warnings: [
            ...ruleInspection.warnings,
            ...moduleInspection.warnings,
            ...arkMainInspection.warnings,
        ],
    };
}

function normalizeIds(values?: string[]): string[] {
    return [...new Set((values || []).map(item => item.trim()).filter(Boolean))];
}
