"use strict";
/*
 * Copyright (c) 2024-2025 Huawei Device Co., Ltd.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.addCfg2Stmt = exports.getCallbackMethodFromStmt = exports.COMPONENT_LIFECYCLE_METHOD_NAME = exports.CALLBACK_METHOD_NAME = exports.LIFECYCLE_METHOD_NAME = void 0;
const Type_1 = require("../core/base/Type");
exports.LIFECYCLE_METHOD_NAME = [
    // --- UIAbility (from @ohos.app.ability.UIAbility.d.ts) ---
    'onCreate',
    'onDestroy',
    'onDestroyAsync',
    'onWindowStageCreate',
    'onWindowStageWillDestroy',
    'onWindowStageDestroy',
    'onWindowStageRestore',
    'onForeground',
    'onWillForeground',
    'onDidForeground',
    'onBackground',
    'onWillBackground',
    'onDidBackground',
    'onContinue',
    'onNewWant',
    'onDump',
    'onSaveState',
    'onSaveStateAsync',
    'onShare',
    'onPrepareToTerminate',
    'onPrepareToTerminateAsync',
    'onBackPressed',
    'onCollaborate',
    'onBackup',
    'onRestore',
    // --- AbilityStage (from @ohos.app.ability.AbilityStage.d.ts) ---
    'onAcceptWant',
    'onAcceptWantAsync',
    'onNewProcessRequest',
    'onNewProcessRequestAsync',
    'onMemoryLevel',
    'onPrepareTermination',
    'onPrepareTerminationAsync',
    // --- ServiceExtensionAbility (from @ohos.app.ability.ServiceExtensionAbility.d.ts) ---
    'onRequest',
    'onConnect',
    'onDisconnect',
    'onDisconnectAsync',
    'onReconnect',
    // --- FormExtensionAbility (from @ohos.app.form.FormExtensionAbility.d.ts) ---
    'onAddForm',
    'onCastToNormalForm',
    'onUpdateForm',
    'onChangeFormVisibility',
    'onFormEvent',
    'onRemoveForm',
    'onAcquireFormState',
    'onFormLocationChanged',
    'onSizeChanged',
    // --- UIExtensionAbility (from @ohos.app.ability.UIExtensionAbility.d.ts) ---
    'onSessionCreate',
    'onSessionDestroy',
    // --- Shared across multiple Ability types ---
    'onConfigurationUpdate',
    // --- DriverExtensionAbility (from @ohos.app.ability.DriverExtensionAbility.d.ts) ---
    'onInit',
    // --- AutoFillExtensionAbility (from @ohos.app.ability.AutoFillExtensionAbility.d.ts) ---
    'onFillRequest',
    'onSaveRequest',
    'onUpdateRequest',
    // --- FenceExtensionAbility (from @ohos.app.ability.FenceExtensionAbility.d.ts) ---
    'onFenceStatusChange',
    // --- PrintExtensionAbility (from @ohos.app.ability.PrintExtensionAbility.d.ts) ---
    'onStartDiscoverPrinter',
    'onStopDiscoverPrinter',
    'onConnectPrinter',
    'onDisconnectPrinter',
    'onStartPrintJob',
    'onCancelPrintJob',
    'onRequestPrinterCapability',
    'onRequestPreview',
    // --- PhotoEditorExtensionAbility (from @ohos.app.ability.PhotoEditorExtensionAbility.d.ts) ---
    'onStartContentEditing',
    // --- UIServiceExtensionAbility (from @ohos.app.ability.UIServiceExtensionAbility.d.ts) ---
    'onWindowWillCreate',
    'onWindowDidCreate',
    'onData',
    // --- ChildProcess (from @ohos.app.ability.ChildProcess.d.ts) ---
    'onStart',
    // --- InsightIntentExecutor (from @ohos.app.ability.InsightIntentExecutor.d.ts) ---
    'onExecuteInUIAbilityForegroundMode',
    'onExecuteInUIAbilityBackgroundMode',
    'onExecuteInUIExtensionAbility',
    'onExecuteInServiceExtensionAbility',
    // --- BackupExtensionAbility (from @ohos.application.BackupExtensionAbility.d.ts) ---
    'onRestoreEx',
    'onBackupEx',
    'onProcess',
    'onRelease',
    // --- LiveFormExtensionAbility (from @ohos.app.form.LiveFormExtensionAbility.d.ts) ---
    'onLiveFormCreate',
    'onLiveFormDestroy',
    // --- AccessibilityExtensionAbility (from @ohos.application.AccessibilityExtensionAbility.d.ts) ---
    'onAccessibilityConnect',
    'onAccessibilityDisconnect',
    'onAccessibilityEvent',
    'onAccessibilityEventInfo',
    'onAccessibilityKeyEvent',
    // --- EnterpriseAdminExtensionAbility (from @ohos.enterprise.EnterpriseAdminExtensionAbility.d.ts) ---
    'onAdminEnabled',
    'onAdminDisabled',
    'onBundleAdded',
    'onBundleRemoved',
    'onAppStart',
    'onAppStop',
    'onSystemUpdate',
    'onAccountAdded',
    'onAccountSwitched',
    'onAccountRemoved',
    'onKioskModeEntering',
    'onKioskModeExiting',
    // --- WindowExtensionAbility (from @ohos.application.WindowExtensionAbility.d.ts) ---
    'onWindowReady',
    // --- WallpaperExtensionAbility (from @ohos.WallpaperExtensionAbility.d.ts) ---
    'onWallpaperChange',
    // --- FaultLogExtensionAbility (from @ohos.hiviewdfx.FaultLogExtensionAbility.d.ts) ---
    'onFaultReportReady',
    // --- AdsServiceExtensionAbility (from @ohos.advertising.AdsServiceExtensionAbility.d.ts) ---
    'onLoadAd',
    'onLoadAdWithMultiSlots',
    // --- StaticSubscriberExtensionAbility (from @ohos.application.StaticSubscriberExtensionAbility.d.ts) ---
    'onReceiveEvent',
    // --- FormExtensionAbility additional (from @ohos.app.form.FormExtensionAbility.d.ts) ---
    'onShareForm',
    'onAcquireFormData',
    'onStop',
    // --- DriverExtensionAbility additional ---
    'onKeyEvent',
    // --- WorkSchedulerExtensionAbility (from @ohos.WorkSchedulerExtensionAbility.d.ts) ---
    'onWorkStart',
    'onWorkStop',
    // --- FormExtensionAbility / general ---
    'onVisibilityChange',
];
exports.CALLBACK_METHOD_NAME = [
    'onClick',
    'onTouch',
    'onAppear',
    'onDisAppear',
    'onAttach',
    'onDetach',
    'onDragStart',
    'onDragEnter',
    'onDragMove',
    'onDragLeave',
    'onDrop',
    'onDragEnd',
    'onPreDrag',
    'onKeyEvent',
    'onKeyPreIme',
    'onFocus',
    'onBlur',
    'onHover',
    'onMouse',
    'onAreaChange',
    'onVisibleAreaChange',
    'onGestureJudgeBegin',
    'onSizeChange',
    'onChange',
];
exports.COMPONENT_LIFECYCLE_METHOD_NAME = [
    'build',
    'aboutToAppear',
    'aboutToDisappear',
    'aboutToReuse',
    'aboutToRecycle',
    'onWillApplyTheme',
    'onLayout',
    'onPlaceChildren',
    'onMeasure',
    'onMeasureSize',
    'onPageShow',
    'onPageHide',
    'onFormRecycle',
    'onFormRecover',
    'onBackPress',
    'pageTransition',
    'onDidBuild',
    'onNewParam',
];
function getCallbackMethodFromStmt(stmt, scene) {
    const invokeExpr = stmt.getInvokeExpr();
    if (invokeExpr === undefined ||
        invokeExpr.getMethodSignature().getDeclaringClassSignature().getClassName() !== '' ||
        !exports.CALLBACK_METHOD_NAME.includes(invokeExpr.getMethodSignature().getMethodSubSignature().getMethodName())) {
        return null;
    }
    for (const arg of invokeExpr.getArgs()) {
        const argType = arg.getType();
        if (argType instanceof Type_1.FunctionType) {
            const cbMethod = scene.getMethod(argType.getMethodSignature());
            if (cbMethod) {
                return cbMethod;
            }
        }
    }
    return null;
}
exports.getCallbackMethodFromStmt = getCallbackMethodFromStmt;
function addCfg2Stmt(method) {
    const cfg = method.getCfg();
    if (cfg) {
        for (const block of cfg.getBlocks()) {
            for (const stmt of block.getStmts()) {
                stmt.setCfg(cfg);
            }
        }
    }
}
exports.addCfg2Stmt = addCfg2Stmt;
