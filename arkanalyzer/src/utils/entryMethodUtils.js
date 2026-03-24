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
exports.COMPONENT_LIFECYCLE_METHOD_NAME = exports.CALLBACK_METHOD_NAME = exports.LIFECYCLE_METHOD_NAME = void 0;
exports.getCallbackMethodFromStmt = getCallbackMethodFromStmt;
exports.addCfg2Stmt = addCfg2Stmt;
const Type_1 = require("../core/base/Type");
exports.LIFECYCLE_METHOD_NAME = [
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
    'onAcceptWant',
    'onAcceptWantAsync',
    'onNewProcessRequest',
    'onNewProcessRequestAsync',
    'onMemoryLevel',
    'onPrepareTermination',
    'onPrepareTerminationAsync',
    'onRequest',
    'onConnect',
    'onDisconnect',
    'onDisconnectAsync',
    'onReconnect',
    'onAddForm',
    'onCastToNormalForm',
    'onUpdateForm',
    'onChangeFormVisibility',
    'onFormEvent',
    'onRemoveForm',
    'onAcquireFormState',
    'onFormLocationChanged',
    'onSizeChanged',
    'onSessionCreate',
    'onSessionDestroy',
    'onConfigurationUpdate',
    'onInit',
    'onFillRequest',
    'onSaveRequest',
    'onUpdateRequest',
    'onFenceStatusChange',
    'onStartDiscoverPrinter',
    'onStopDiscoverPrinter',
    'onConnectPrinter',
    'onDisconnectPrinter',
    'onStartPrintJob',
    'onCancelPrintJob',
    'onRequestPrinterCapability',
    'onRequestPreview',
    'onStartContentEditing',
    'onWindowWillCreate',
    'onWindowDidCreate',
    'onData',
    'onStart',
    'onExecuteInUIAbilityForegroundMode',
    'onExecuteInUIAbilityBackgroundMode',
    'onExecuteInUIExtensionAbility',
    'onExecuteInServiceExtensionAbility',
    'onRestoreEx',
    'onBackupEx',
    'onProcess',
    'onRelease',
    'onLiveFormCreate',
    'onLiveFormDestroy',
    'onAccessibilityConnect',
    'onAccessibilityDisconnect',
    'onAccessibilityEvent',
    'onAccessibilityEventInfo',
    'onAccessibilityKeyEvent',
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
    'onWindowReady',
    'onWallpaperChange',
    'onFaultReportReady',
    'onLoadAd',
    'onLoadAdWithMultiSlots',
    'onReceiveEvent',
    'onShareForm',
    'onAcquireFormData',
    'onStop',
    'onKeyEvent',
    'onWorkStart',
    'onWorkStop',
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
//# sourceMappingURL=entryMethodUtils.js.map