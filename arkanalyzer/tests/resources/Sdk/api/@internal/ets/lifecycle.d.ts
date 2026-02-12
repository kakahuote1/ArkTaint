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

import Want from '../../@ohos.app.ability.Want';
import { ResultSet } from '../../data/rdb/resultSet';
import { AbilityInfo } from '../../bundle/abilityInfo';
import { DataAbilityResult } from '../../ability/dataAbilityResult';
import { DataAbilityOperation } from '../../ability/dataAbilityOperation';
import dataAbility from '../../@ohos.data.dataAbility';
import formBindingData from '../../@ohos.application.formBindingData';
import formInfo from '../../@ohos.app.form.formInfo';
import rdb from '../../@ohos.data.rdb';
import rpc from '../../@ohos.rpc';
import resourceManager from '../../@ohos.resourceManager';
import { PacMap } from '../../ability/dataAbilityHelper';
import { AsyncCallback } from '../../@ohos.base';


export declare interface LifecycleForm {

    onCreate?(want: Want): formBindingData.FormBindingData;

    onCastToNormal?(formId: string): void;

    onUpdate?(formId: string): void;

    onVisibilityChange?(newStatus: Record<string, number>): void;

    onEvent?(formId: string, message: string): void;

    onDestroy?(formId: string): void;

    onAcquireFormState?(want: Want): formInfo.FormState;

    onShare?(formId: string): { [key: string]: any };

    onShareForm?(formId: string): Record<string, Object>;
}


export declare interface LifecycleApp {

    onShow?(): void;


    onHide?(): void;


    onDestroy?(): void;


    onCreate?(): void;


    onWindowDisplayModeChanged?(isShownInMultiWindow: boolean, newConfig: resourceManager.Configuration): void;


    onStartContinuation?(): boolean;


    onSaveData?(data: Object): boolean;


    onCompleteContinuation?(result: number): void;


    onRestoreData?(data: Object): void;


    onRemoteTerminated?(): void;


    onSaveAbilityState?(outState: PacMap): void;


    onRestoreAbilityState?(inState: PacMap): void;


    onInactive?(): void;


    onActive?(): void;


    onNewWant?(want: Want): void;


    onMemoryLevel?(level: number): void;
}


export declare interface LifecycleService {

    onStart?(): void;


    onCommand?(want: Want, startId: number): void;


    onStop?(): void;


    onConnect?(want: Want): rpc.RemoteObject;


    onDisconnect?(want: Want): void;


    onReconnect?(want: Want): void;
}


export declare interface LifecycleData {

    update?(
        uri: string,
        valueBucket: rdb.ValuesBucket,
        predicates: dataAbility.DataAbilityPredicates,
        callback: AsyncCallback<number>
    ): void;


    query?(
        uri: string,
        columns: Array<string>,
        predicates: dataAbility.DataAbilityPredicates,
        callback: AsyncCallback<ResultSet>
    ): void;


    delete?(uri: string, predicates: dataAbility.DataAbilityPredicates, callback: AsyncCallback<number>): void;


    normalizeUri?(uri: string, callback: AsyncCallback<string>): void;


    batchInsert?(uri: string, valueBuckets: Array<rdb.ValuesBucket>, callback: AsyncCallback<number>): void;


    denormalizeUri?(uri: string, callback: AsyncCallback<string>): void;


    insert?(uri: string, valueBucket: rdb.ValuesBucket, callback: AsyncCallback<number>): void;


    openFile?(uri: string, mode: string, callback: AsyncCallback<number>): void;


    getFileTypes?(uri: string, mimeTypeFilter: string, callback: AsyncCallback<Array<string>>): void;


    onInitialized?(info: AbilityInfo): void;


    getType?(uri: string, callback: AsyncCallback<string>): void;


    executeBatch?(ops: Array<DataAbilityOperation>, callback: AsyncCallback<Array<DataAbilityResult>>): void;


    call?(method: string, arg: string, extras: PacMap, callback: AsyncCallback<PacMap>): void;
}
