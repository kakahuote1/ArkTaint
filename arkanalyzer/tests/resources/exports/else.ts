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
import webview from '@ohos.web.webview';
import i18n from '@ohos.i18n';
import { hilog } from '@kit.PerformanceAnalysisKit';

export function something() {
    webview.WebviewController.setWebDebuggingAccess(false);
    const controller: webview.WebviewController = new webview.WebviewController();
    controller.loadUrl('');
    hilog.info(0x0000, 'func', '%{public}', 'Ability onCreate');
}

export function some() {
    let calendar: i18n.Calendar = i18n.getCalendar('gregory');
    calendar.getTimeZone();
    return new dfs();
}

let calendar = i18n.getCalendar(i18n.getSystemLocale());
calendar.getTimeZone();

export default class dfs {
    public async dynamicImport() {
        let a = await import('./exportSample');
        const z = a.z;
        const default1 = a.default;
        const b = a.b;
        let f = a.testing;
        const space = a.MyNameSpace;
    }

}

const a1: Set<string> = new Set<any>();
const a2: Map<string, string> = new Map<any, string>();
const a3: Set<string[]> = new Set<any[]>();
const a4: Set<Set<Set<string>>> = new Set<Set<Set<any>>>();