export const ARK_MAIN_REACTIVE_ANCHOR_METHOD_NAMES = [
    "build",
    "aboutToAppear",
    "onPageShow",
    "render",
];

export const ARK_MAIN_ABILITY_BASE_CLASS_NAMES = new Set([
    "Ability",
    "UIAbility",
    "ExtensionAbility",
    "UiExtensionAbility",
    "UIExtensionAbility",
    "FormExtensionAbility",
    "ServiceExtensionAbility",
    "BackupExtensionAbility",
    "InputMethodExtensionAbility",
    "WorkSchedulerExtensionAbility",
    "AbilityStage",
    "DriverExtensionAbility",
    "AutoFillExtensionAbility",
    "VpnExtensionAbility",
    "FenceExtensionAbility",
    "PrintExtensionAbility",
    "PhotoEditorExtensionAbility",
    "UIServiceExtensionAbility",
    "AppServiceExtensionAbility",
    "ShareExtensionAbility",
    "ActionExtensionAbility",
    "EmbeddableUIAbility",
    "EmbeddedUIExtensionAbility",
    "MediaControlExtensionAbility",
    "UserAuthExtensionAbility",
    "FormEditExtensionAbility",
    "ChildProcess",
    "InsightIntentExecutor",
    "LiveFormExtensionAbility",
    "AccessibilityExtensionAbility",
    "WindowExtensionAbility",
    "StaticSubscriberExtensionAbility",
    "DistributedExtensionAbility",
    "EnterpriseAdminExtensionAbility",
    "FaultLogExtensionAbility",
    "WallpaperExtensionAbility",
    "DataShareExtensionAbility",
    "SelectionExtensionAbility",
    "AdsServiceExtensionAbility",
]);

export const ARK_MAIN_ABILITY_HANDOFF_TARGET_METHOD_NAMES = new Set([
    "onNewWant",
    "onAcceptWant",
    "onAcceptWantAsync",
    "onNewProcessRequest",
    "onNewProcessRequestAsync",
]);

export const ARK_MAIN_PAGE_METHOD_NAMES = new Set([
    "build",
    "aboutToAppear",
    "aboutToDisappear",
    "onPageShow",
    "onPageHide",
    "onBackPress",
    "pageTransition",
    "onDidBuild",
    "render",
]);

export const ARK_MAIN_ROUTER_OWNER_CLASS_NAMES = new Set([
    "Router",
    "NavPathStack",
]);

export const ARK_MAIN_NAVIGATION_SOURCE_OWNER_CLASS_NAMES = new Set([
    "Router",
    "NavPathStack",
    "NavDestination",
]);

export const ARK_MAIN_ROUTER_SOURCE_METHOD_NAMES = new Set([
    "pushUrl",
    "replaceUrl",
    "pushNamedRoute",
    "pushPath",
    "pushPathByName",
    "replacePath",
    "trigger",
]);

export const ARK_MAIN_ROUTER_TRIGGER_METHOD_NAMES = new Set([
    "getParams",
]);
