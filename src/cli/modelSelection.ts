import type { RuleLoaderOptions } from "../core/rules/RuleLoader";
import { inspectRulePacks } from "../core/rules/RuleLoader";
import { inspectModules } from "../core/orchestration/modules/ModuleLoader";
import { inspectArkMainProjects } from "../core/entry/arkmain/ArkMainLoader";
import {
    cloneModelPackPlaneState,
    emptyModelPackPlaneState,
    hasAnyModelPackPlane,
    intersectModelPackPlaneState,
    mergeModelPackPlaneState,
    modelPackPlaneList,
    ModelPackPlaneState,
    normalizeModelPackSelections,
    planeStateFromSelection,
    subtractModelPackPlaneState,
} from "../core/model/ModelPack";

export interface ResolveModelSelectionsOptions {
    ruleOptions: RuleLoaderOptions;
    modelRoots?: string[];
    enabledModels?: string[];
    disabledModels?: string[];
}

export interface ModelPackCatalogEntry {
    packId: string;
    available: ModelPackPlaneState;
    enabled: ModelPackPlaneState;
}

export interface ResolvedModelSelections {
    ruleOptions: RuleLoaderOptions;
    enabledModuleProjects: string[];
    disabledModuleProjects: string[];
    enabledArkMainProjects: string[];
    disabledArkMainProjects: string[];
    warnings: string[];
    catalog: ModelPackCatalogEntry[];
}

export interface ModelInspectResult {
    catalog: ModelPackCatalogEntry[];
    warnings: string[];
}

export function resolveModelSelections(
    options: ResolveModelSelectionsOptions,
): ResolvedModelSelections {
    const inspection = inspectModelPacks(options);
    const selectedByPack = new Map<string, ModelPackPlaneState>();

    for (const selection of normalizeModelPackSelections(options.enabledModels)) {
        const available = inspection.catalog.find(entry => entry.packId === selection.packId)?.available;
        if (!available) {
            inspection.warnings.push(`requested model pack not found: ${selection.packId}`);
            continue;
        }
        const allowed = intersectModelPackPlaneState(
            planeStateFromSelection(selection),
            available,
        );
        const requested = planeStateFromSelection(selection);
        for (const plane of modelPackPlaneList(requested)) {
            if (!available[plane]) {
                inspection.warnings.push(`requested model plane not found: ${selection.packId}:${plane}`);
            }
        }
        if (!hasAnyModelPackPlane(allowed)) {
            continue;
        }
        const current = selectedByPack.get(selection.packId) || emptyModelPackPlaneState();
        selectedByPack.set(selection.packId, mergeModelPackPlaneState(current, allowed));
    }

    for (const selection of normalizeModelPackSelections(options.disabledModels)) {
        const available = inspection.catalog.find(entry => entry.packId === selection.packId)?.available;
        if (!available) {
            continue;
        }
        const blocked = intersectModelPackPlaneState(
            planeStateFromSelection(selection),
            available,
        );
        const current = selectedByPack.get(selection.packId);
        if (!current) {
            continue;
        }
        subtractModelPackPlaneState(current, blocked);
        if (!hasAnyModelPackPlane(current)) {
            selectedByPack.delete(selection.packId);
        }
    }

    const enabledRulePacks = [...selectedByPack.entries()]
        .filter(([, state]) => state.rules)
        .map(([packId]) => packId)
        .sort((a, b) => a.localeCompare(b));
    const enabledModuleProjects = [...selectedByPack.entries()]
        .filter(([, state]) => state.modules)
        .map(([packId]) => packId)
        .sort((a, b) => a.localeCompare(b));
    const enabledArkMainProjects = [...selectedByPack.entries()]
        .filter(([, state]) => state.arkmain)
        .map(([packId]) => packId)
        .sort((a, b) => a.localeCompare(b));

    const catalog = inspection.catalog.map(entry => ({
        ...entry,
        enabled: cloneModelPackPlaneState(selectedByPack.get(entry.packId)),
    }));

    return {
        ruleOptions: {
            ...options.ruleOptions,
            enabledRulePacks,
            disabledRulePacks: [],
        },
        enabledModuleProjects,
        disabledModuleProjects: [],
        enabledArkMainProjects,
        disabledArkMainProjects: [],
        warnings: inspection.warnings,
        catalog,
    };
}

export function inspectModelPacks(
    options: ResolveModelSelectionsOptions,
): ModelInspectResult {
    const warnings: string[] = [];
    const ruleInspection = inspectRulePacks({
        ...options.ruleOptions,
        enabledRulePacks: [],
        disabledRulePacks: [],
    });
    const moduleInspection = inspectModules({
        moduleRoots: options.modelRoots || [],
        includeBuiltinModules: true,
        enabledModuleProjects: [],
        disabledModuleProjects: [],
    });
    const arkMainInspection = inspectArkMainProjects({
        arkMainRoots: options.modelRoots || [],
        includeBuiltinArkMain: true,
        enabledArkMainProjects: [],
        disabledArkMainProjects: [],
    });
    warnings.push(
        ...ruleInspection.warnings,
        ...moduleInspection.warnings,
        ...arkMainInspection.warnings,
    );

    const byPack = new Map<string, ModelPackPlaneState>();
    const ensure = (packId: string): ModelPackPlaneState => {
        const current = byPack.get(packId);
        if (current) {
            return current;
        }
        const created = emptyModelPackPlaneState();
        byPack.set(packId, created);
        return created;
    };
    for (const packId of ruleInspection.discoveredRulePacks) {
        ensure(packId).rules = true;
    }
    for (const packId of moduleInspection.discoveredModuleProjects) {
        ensure(packId).modules = true;
    }
    for (const packId of arkMainInspection.discoveredArkMainProjects) {
        ensure(packId).arkmain = true;
    }

    return {
        catalog: [...byPack.entries()]
            .map(([packId, available]) => ({
                packId,
                available: cloneModelPackPlaneState(available),
                enabled: emptyModelPackPlaneState(),
            }))
            .sort((a, b) => a.packId.localeCompare(b.packId)),
        warnings,
    };
}
