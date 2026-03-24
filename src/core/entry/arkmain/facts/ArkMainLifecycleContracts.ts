import { ArkMainFactKind, ArkMainPhaseName } from "../ArkMainTypes";

export interface ArkMainLifecycleContractMatch {
    phase: ArkMainPhaseName;
    kind: Extract<ArkMainFactKind, "ability_lifecycle" | "page_build" | "page_lifecycle">;
    entryFamily: "ability_lifecycle" | "page_build" | "page_lifecycle";
    entryShape: "override_slot" | "declaration_owner_slot";
    reason: string;
}

interface ArkMainLifecycleContractRule {
    phase: ArkMainPhaseName;
    kind: ArkMainLifecycleContractMatch["kind"];
    entryFamily: ArkMainLifecycleContractMatch["entryFamily"];
    entryShape: ArkMainLifecycleContractMatch["entryShape"];
    reasonPrefix: string;
    methodNames: ReadonlySet<string>;
}

const COMPONENT_LIFECYCLE_CONTRACT_RULES: readonly ArkMainLifecycleContractRule[] = [
    {
        phase: "composition",
        kind: "page_build",
        entryFamily: "page_build",
        entryShape: "declaration_owner_slot",
        reasonPrefix: "Component lifecycle contract composition",
        methodNames: new Set([
            "build",
        ]),
    },
    {
        phase: "composition",
        kind: "page_lifecycle",
        entryFamily: "page_lifecycle",
        entryShape: "declaration_owner_slot",
        reasonPrefix: "Component lifecycle contract composition",
        methodNames: new Set([
            "aboutToAppear",
            "aboutToReuse",
            "onPageShow",
            "onWillApplyTheme",
            "onDidBuild",
            "onNewParam",
        ]),
    },
    {
        phase: "interaction",
        kind: "page_lifecycle",
        entryFamily: "page_lifecycle",
        entryShape: "declaration_owner_slot",
        reasonPrefix: "Component lifecycle contract interaction",
        methodNames: new Set([
            "onBackPress",
            "pageTransition",
            "onLayout",
            "onMeasure",
            "onPlaceChildren",
            "onMeasureSize",
            "onFormRecycle",
            "onFormRecover",
        ]),
    },
    {
        phase: "teardown",
        kind: "page_lifecycle",
        entryFamily: "page_lifecycle",
        entryShape: "declaration_owner_slot",
        reasonPrefix: "Component lifecycle contract teardown",
        methodNames: new Set([
            "aboutToDisappear",
            "aboutToRecycle",
            "onPageHide",
        ]),
    },
];

const ABILITY_HANDOFF_METHOD_NAMES = new Set([
    "onNewWant",
    "onAcceptWant",
    "onAcceptWantAsync",
    "onNewProcessRequest",
    "onNewProcessRequestAsync",
]);

const ABILITY_BOOTSTRAP_METHOD_NAMES = new Set([
    "onCreate",
    "onAddForm",
    "onRestore",
    "onRestoreEx",
    "onWorkStart",
    "onSessionCreate",
    "onWindowStageCreate",
    "onWindowStageRestore",
    "onForeground",
    "onWillForeground",
    "onDidForeground",
    "onInit",
    "onStart",
    "onRequest",
    "onFillRequest",
    "onStartContentEditing",
    "onData",
    "onWindowWillCreate",
    "onWindowDidCreate",
    "onFenceStatusChange",
    "onStartDiscoverPrinter",
    "onConnectPrinter",
    "onStartPrintJob",
    "onExecuteInUIAbilityForegroundMode",
    "onExecuteInUIAbilityBackgroundMode",
    "onExecuteInUIExtensionAbility",
    "onExecuteInServiceExtensionAbility",
    "onLiveFormCreate",
    "onAccessibilityConnect",
    "onAdminEnabled",
    "onWindowReady",
]);

const ABILITY_INTERACTION_METHOD_NAMES = new Set([
    "onConnect",
    "onBackup",
    "onBackupEx",
    "onUpdateForm",
    "onAcquireFormState",
    "onAcquireFormData",
    "onCastToNormalForm",
    "onFormEvent",
    "onShareForm",
    "onVisibilityChange",
    "onChangeFormVisibility",
    "onConfigurationUpdate",
    "onContinue",
    "onDump",
    "onSaveState",
    "onSaveStateAsync",
    "onShare",
    "onCollaborate",
    "onMemoryLevel",
    "onSaveRequest",
    "onUpdateRequest",
    "onFormLocationChanged",
    "onSizeChanged",
    "onReconnect",
    "onRequestPrinterCapability",
    "onRequestPreview",
    "onCancelPrintJob",
    "onStopDiscoverPrinter",
    "onDisconnectPrinter",
    "onProcess",
    "onAccessibilityEvent",
    "onAccessibilityEventInfo",
    "onKeyEvent",
    "onAccessibilityKeyEvent",
    "onReceiveEvent",
    "onWallpaperChange",
    "onFaultReportReady",
    "onLoadAd",
    "onLoadAdWithMultiSlots",
    "onBundleAdded",
    "onBundleRemoved",
    "onAppStart",
    "onAppStop",
    "onSystemUpdate",
    "onAccountAdded",
    "onAccountSwitched",
    "onAccountRemoved",
    "onKioskModeEntering",
    "onKioskModeExiting",
]);

const ABILITY_TEARDOWN_METHOD_NAMES = new Set([
    "onBackground",
    "onWillBackground",
    "onDidBackground",
    "onDisconnect",
    "onDisconnectAsync",
    "onWorkStop",
    "onWindowStageWillDestroy",
    "onWindowStageDestroy",
    "onDestroy",
    "onDestroyAsync",
    "onRemoveForm",
    "onSessionDestroy",
    "onBackPressed",
    "onPrepareToTerminate",
    "onPrepareToTerminateAsync",
    "onPrepareTermination",
    "onPrepareTerminationAsync",
    "onLiveFormDestroy",
    "onRelease",
    "onAdminDisabled",
    "onAccessibilityDisconnect",
    "onStop",
]);

export function resolveAbilityLifecycleContractFromOverride(methodName: string): ArkMainLifecycleContractMatch | null {
    if (
        !ABILITY_BOOTSTRAP_METHOD_NAMES.has(methodName)
        && !ABILITY_HANDOFF_METHOD_NAMES.has(methodName)
        && !ABILITY_INTERACTION_METHOD_NAMES.has(methodName)
        && !ABILITY_TEARDOWN_METHOD_NAMES.has(methodName)
    ) {
        return null;
    }
    const phase = resolveAbilityLifecyclePhase(methodName);
    return {
        phase,
        kind: "ability_lifecycle",
        entryFamily: "ability_lifecycle",
        entryShape: "override_slot",
        reason: `Ability lifecycle override slot ${methodName}`,
    };
}

export function resolveAbilityLifecycleContract(methodName: string): ArkMainLifecycleContractMatch | null {
    if (
        !ABILITY_BOOTSTRAP_METHOD_NAMES.has(methodName)
        && !ABILITY_HANDOFF_METHOD_NAMES.has(methodName)
        && !ABILITY_INTERACTION_METHOD_NAMES.has(methodName)
        && !ABILITY_TEARDOWN_METHOD_NAMES.has(methodName)
    ) {
        return null;
    }
    return resolveAbilityLifecycleContractFromOverride(methodName);
}

export function resolveComponentLifecycleContract(methodName: string): ArkMainLifecycleContractMatch | null {
    return resolveContractByMethodName(COMPONENT_LIFECYCLE_CONTRACT_RULES, methodName);
}

function resolveAbilityLifecyclePhase(methodName: string): ArkMainPhaseName {
    if (ABILITY_HANDOFF_METHOD_NAMES.has(methodName)) {
        return "reactive_handoff";
    }
    if (ABILITY_INTERACTION_METHOD_NAMES.has(methodName)) {
        return "interaction";
    }
    if (ABILITY_TEARDOWN_METHOD_NAMES.has(methodName)) {
        return "teardown";
    }
    return "bootstrap";
}

function resolveContractByMethodName(
    rules: readonly ArkMainLifecycleContractRule[],
    methodName: string,
): ArkMainLifecycleContractMatch | null {
    for (const rule of rules) {
        if (!rule.methodNames.has(methodName)) continue;
        return {
            phase: rule.phase,
            kind: rule.kind,
            entryFamily: rule.entryFamily,
            entryShape: rule.entryShape,
            reason: `${rule.reasonPrefix} ${methodName}`,
        };
    }
    return null;
}
