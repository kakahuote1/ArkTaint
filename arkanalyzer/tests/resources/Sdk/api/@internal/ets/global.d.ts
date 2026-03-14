/*
 * Copyright (c) 2024 Huawei Device Co., Ltd.
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

export declare class console {


    static debug(message: string, ...arguments: any[]): void;


    static log(message: string, ...arguments: any[]): void;


    static info(message: string, ...arguments: any[]): void;


    static warn(message: string, ...arguments: any[]): void;


    static error(message: string, ...arguments: any[]): void;


    static assert(value?: Object, ...arguments: Object[]): void;


    static count(label?: string): void;


    static countReset(label?: string): void;


    static dir(dir?: Object): void;


    static dirxml(...arguments: Object[]): void;


    static group(...arguments: Object[]): void;


    static groupCollapsed(...arguments: Object[]): void;


    static groupEnd(): void;


    static table(tableData?: Object): void;


    static time(label?: string): void;


    static timeEnd(label?: string): void;


    static timeLog(label?: string, ...arguments: Object[]): void;


    static trace(...arguments: Object[]): void;


    static traceHybridStack(): void;
}


export declare function setInterval(handler: Function | string, delay: number, ...arguments: any[]): number;


export declare function setTimeout(handler: Function | string, delay?: number, ...arguments: any[]): number;


export declare function clearInterval(intervalID?: number): void;


export declare function clearTimeout(timeoutID?: number): void;


export declare function canIUse(syscap: string): boolean;


export declare function getInspectorByKey(id: string): string;


export declare function getInspectorTree(): Object;


export declare function sendEventByKey(id: string, action: number, params: string): boolean;


export declare function sendTouchEvent(event: TouchObject): boolean;


export declare function sendKeyEvent(event: KeyEvent): boolean;


export declare function sendMouseEvent(event: MouseEvent): boolean;


export declare function markModuleCollectable(namespace: Object): void;


export declare function loadNativeModule(moduleName: string): Object;