import { createBuiltinModuleAsset } from "../../moduleAssetHelpers";
import { officialInvokeSurfaceFromId } from "../../moduleAssetHelpers";
import { officialDecoratorSurfaceFromId } from "../../moduleAssetHelpers";

const propDecoratorCanonicalApiIds = [
    "api:official:arkui:module=api%2F%40internal%2Fcomponent%2Fets%2Fcommon.d.ts:file=api%2F%40internal%2Fcomponent%2Fets%2Fcommon.d.ts:export=named%3AStorageProp:decl=file%3Aapi%2F%40internal%2Fcomponent%2Fets%2Fcommon.d.ts:member=decorator%3AStorageProp:invoke=decorator:params=0%3Astring:ret=PropertyDecorator",
    "api:official:arkui:module=api%2F%40internal%2Fcomponent%2Fets%2Fcommon.d.ts:file=api%2F%40internal%2Fcomponent%2Fets%2Fcommon.d.ts:export=named%3ALocalStorageProp:decl=file%3Aapi%2F%40internal%2Fcomponent%2Fets%2Fcommon.d.ts:member=decorator%3ALocalStorageProp:invoke=decorator:params=0%3Astring:ret=PropertyDecorator",
];

const linkDecoratorCanonicalApiIds = [
    "api:official:arkui:module=api%2F%40internal%2Fcomponent%2Fets%2Fcommon.d.ts:file=api%2F%40internal%2Fcomponent%2Fets%2Fcommon.d.ts:export=named%3AStorageLink:decl=file%3Aapi%2F%40internal%2Fcomponent%2Fets%2Fcommon.d.ts:member=decorator%3AStorageLink:invoke=decorator:params=0%3Astring:ret=PropertyDecorator",
    "api:official:arkui:module=api%2F%40internal%2Fcomponent%2Fets%2Fcommon.d.ts:file=api%2F%40internal%2Fcomponent%2Fets%2Fcommon.d.ts:export=named%3ALocalStorageLink:decl=file%3Aapi%2F%40internal%2Fcomponent%2Fets%2Fcommon.d.ts:member=decorator%3ALocalStorageLink:invoke=decorator:params=0%3Astring:ret=PropertyDecorator",
];

const rawWriteApis = [
    {
        "canonicalApiIds": [
            "api:official:arkui:module=api%2Farkui%2FstateManagement%2Fstorages%2FappStorage.d.ets:file=api%2Farkui%2FstateManagement%2Fstorages%2FappStorage.d.ets:export=named%3AAppStorage:decl=class%3AAppStorage:member=method%3Astatic%3Aset:invoke=call:params=0%3Astring%2C1%3AT:ret=boolean",
            "api:official:arkui:module=api%2Farkui%2FstateManagement%2Fstorages%2FlocalStorage.d.ets:file=api%2Farkui%2FstateManagement%2Fstorages%2FlocalStorage.d.ets:export=named%3ALocalStorage:decl=class%3ALocalStorage:member=method%3Ainstance%3Aset:invoke=call:params=0%3Astring%2C1%3AT:ret=boolean"
        ],
        "valueIndex": 1
    },
    {
        "canonicalApiIds": [
            "api:official:arkui:module=api%2Farkui%2FstateManagement%2Fstorages%2FappStorage.d.ets:file=api%2Farkui%2FstateManagement%2Fstorages%2FappStorage.d.ets:export=named%3AAppStorage:decl=class%3AAppStorage:member=method%3Astatic%3AsetOrCreate:invoke=call:params=0%3Astring%2C1%3AT:ret=void",
            "api:official:arkui:module=api%2Farkui%2FstateManagement%2Fstorages%2FlocalStorage.d.ets:file=api%2Farkui%2FstateManagement%2Fstorages%2FlocalStorage.d.ets:export=named%3ALocalStorage:decl=class%3ALocalStorage:member=method%3Ainstance%3AsetOrCreate:invoke=call:params=0%3Astring%2C1%3AT:ret=boolean"
        ],
        "valueIndex": 1
    },
    {
        "canonicalApiIds": [
            "api:official:arkui:module=api%2Farkui%2FstateManagement%2Fstorages%2FappStorage.d.ets:file=api%2Farkui%2FstateManagement%2Fstorages%2FappStorage.d.ets:export=named%3AAppStorage:decl=class%3AAppStorage:member=method%3Astatic%3AsetAndLink:invoke=call:params=0%3Astring%2C1%3AT:ret=SubscribedAbstractProperty%3CT%3E",
            "api:official:arkui:module=api%2Farkui%2FstateManagement%2Fstorages%2FlocalStorage.d.ets:file=api%2Farkui%2FstateManagement%2Fstorages%2FlocalStorage.d.ets:export=named%3ALocalStorage:decl=class%3ALocalStorage:member=method%3Ainstance%3AsetAndLink:invoke=call:params=0%3Astring%2C1%3AT:ret=SubscribedAbstractProperty%3CT%3E"
        ],
        "valueIndex": 1
    },
    {
        "canonicalApiIds": [
            "api:official:arkui:module=api%2Farkui%2FstateManagement%2Fstorages%2FappStorage.d.ets:file=api%2Farkui%2FstateManagement%2Fstorages%2FappStorage.d.ets:export=named%3AAppStorage:decl=class%3AAppStorage:member=method%3Astatic%3AsetAndProp:invoke=call:params=0%3Astring%2C1%3AT:ret=SubscribedAbstractProperty%3CT%3E",
            "api:official:arkui:module=api%2Farkui%2FstateManagement%2Fstorages%2FlocalStorage.d.ets:file=api%2Farkui%2FstateManagement%2Fstorages%2FlocalStorage.d.ets:export=named%3ALocalStorage:decl=class%3ALocalStorage:member=method%3Ainstance%3AsetAndProp:invoke=call:params=0%3Astring%2C1%3AT:ret=SubscribedAbstractProperty%3CT%3E"
        ],
        "valueIndex": 1
    },
    {
        "canonicalApiIds": [
            "api:official:arkui:module=api%2Farkui%2FstateManagement%2Fstorages%2FappStorage.d.ets:file=api%2Farkui%2FstateManagement%2Fstorages%2FappStorage.d.ets:export=named%3AAppStorage:decl=class%3AAppStorage:member=method%3Astatic%3AsetAndRef:invoke=call:params=0%3Astring%2C1%3AT:ret=AbstractProperty%3CT%3E",
            "api:official:arkui:module=api%2Farkui%2FstateManagement%2Fstorages%2FlocalStorage.d.ets:file=api%2Farkui%2FstateManagement%2Fstorages%2FlocalStorage.d.ets:export=named%3ALocalStorage:decl=class%3ALocalStorage:member=method%3Ainstance%3AsetAndRef:invoke=call:params=0%3Astring%2C1%3AT:ret=AbstractProperty%3CT%3E"
        ],
        "valueIndex": 1
    },
    {
        "canonicalApiIds": [
            "api:official:openharmony:module=%40ohos.data.distributedData:file=api%2F%40ohos.data.distributedData.d.ts:export=namespace%3AdistributedData.KVStore:decl=interface%3AdistributedData.KVStore:member=method%3Ainstance%3Aput:invoke=call:params=0%3Astring%2C1%3AUint8Array%20%7C%20string%20%7C%20number%20%7C%20boolean:ret=Promise%3Cvoid%3E",
            "api:official:openharmony:module=%40ohos.data.distributedData:file=api%2F%40ohos.data.distributedData.d.ts:export=namespace%3AdistributedData.KVStore:decl=interface%3AdistributedData.KVStore:member=method%3Ainstance%3Aput:invoke=call:params=0%3Astring%2C1%3AUint8Array%20%7C%20string%20%7C%20number%20%7C%20boolean%2C2%3AAsyncCallback%3Cvoid%3E:ret=void",
            "api:official:openharmony:module=%40ohos.data.distributedKVStore:file=api%2F%40ohos.data.distributedKVStore.d.ts:export=namespace%3AdistributedKVStore.SingleKVStore:decl=interface%3AdistributedKVStore.SingleKVStore:member=method%3Ainstance%3Aput:invoke=call:params=0%3Astring%2C1%3AUint8Array%20%7C%20string%20%7C%20number%20%7C%20boolean:ret=Promise%3Cvoid%3E",
            "api:official:openharmony:module=%40ohos.data.distributedKVStore:file=api%2F%40ohos.data.distributedKVStore.d.ts:export=namespace%3AdistributedKVStore.SingleKVStore:decl=interface%3AdistributedKVStore.SingleKVStore:member=method%3Ainstance%3Aput:invoke=call:params=0%3Astring%2C1%3AUint8Array%20%7C%20string%20%7C%20number%20%7C%20boolean%2C2%3AAsyncCallback%3Cvoid%3E:ret=void",
            "api:official:openharmony:module=%40ohos.data.preferences:file=api%2F%40ohos.data.preferences.d.ts:export=namespace%3Apreferences.Preferences:decl=interface%3Apreferences.Preferences:member=method%3Ainstance%3Aput:invoke=call:params=0%3Astring%2C1%3AValueType:ret=Promise%3Cvoid%3E",
            "api:official:openharmony:module=%40ohos.data.preferences:file=api%2F%40ohos.data.preferences.d.ts:export=namespace%3Apreferences.Preferences:decl=interface%3Apreferences.Preferences:member=method%3Ainstance%3Aput:invoke=call:params=0%3Astring%2C1%3AValueType%2C2%3AAsyncCallback%3Cvoid%3E:ret=void",
            "api:official:openharmony:module=%40ohos.data.sendablePreferences:file=api%2F%40ohos.data.sendablePreferences.d.ets:export=namespace%3AsendablePreferences.Preferences:decl=interface%3AsendablePreferences.Preferences:member=method%3Ainstance%3Aput:invoke=call:params=0%3Astring%2C1%3Alang.ISendable:ret=Promise%3Cvoid%3E"
        ],
        "valueIndex": 1
    },
    {
        "canonicalApiIds": [
            "api:official:openharmony:module=%40ohos.data.preferences:file=api%2F%40ohos.data.preferences.d.ts:export=namespace%3Apreferences.Preferences:decl=interface%3Apreferences.Preferences:member=method%3Ainstance%3AputSync:invoke=call:params=0%3Astring%2C1%3AValueType:ret=void",
            "api:official:openharmony:module=%40ohos.data.sendablePreferences:file=api%2F%40ohos.data.sendablePreferences.d.ets:export=namespace%3AsendablePreferences.Preferences:decl=interface%3AsendablePreferences.Preferences:member=method%3Ainstance%3AputSync:invoke=call:params=0%3Astring%2C1%3Alang.ISendable:ret=void"
        ],
        "valueIndex": 1
    },
    {
        "canonicalApiIds": [
            "api:official:openharmony:module=%40ohos.data.distributedData:file=api%2F%40ohos.data.distributedData.d.ts:export=namespace%3AdistributedData.KVStore:decl=interface%3AdistributedData.KVStore:member=method%3Ainstance%3AputBatch:invoke=call:params=0%3AEntry%5B%5D:ret=Promise%3Cvoid%3E",
            "api:official:openharmony:module=%40ohos.data.distributedData:file=api%2F%40ohos.data.distributedData.d.ts:export=namespace%3AdistributedData.KVStore:decl=interface%3AdistributedData.KVStore:member=method%3Ainstance%3AputBatch:invoke=call:params=0%3AEntry%5B%5D%2C1%3AAsyncCallback%3Cvoid%3E:ret=void",
            "api:official:openharmony:module=%40ohos.data.distributedKVStore:file=api%2F%40ohos.data.distributedKVStore.d.ts:export=namespace%3AdistributedKVStore.SingleKVStore:decl=interface%3AdistributedKVStore.SingleKVStore:member=method%3Ainstance%3AputBatch:invoke=call:params=0%3AArray%3CValuesBucket%3E:ret=Promise%3Cvoid%3E",
            "api:official:openharmony:module=%40ohos.data.distributedKVStore:file=api%2F%40ohos.data.distributedKVStore.d.ts:export=namespace%3AdistributedKVStore.SingleKVStore:decl=interface%3AdistributedKVStore.SingleKVStore:member=method%3Ainstance%3AputBatch:invoke=call:params=0%3AArray%3CValuesBucket%3E%2C1%3AAsyncCallback%3Cvoid%3E:ret=void",
            "api:official:openharmony:module=%40ohos.data.distributedKVStore:file=api%2F%40ohos.data.distributedKVStore.d.ts:export=namespace%3AdistributedKVStore.SingleKVStore:decl=interface%3AdistributedKVStore.SingleKVStore:member=method%3Ainstance%3AputBatch:invoke=call:params=0%3AEntry%5B%5D:ret=Promise%3Cvoid%3E",
            "api:official:openharmony:module=%40ohos.data.distributedKVStore:file=api%2F%40ohos.data.distributedKVStore.d.ts:export=namespace%3AdistributedKVStore.SingleKVStore:decl=interface%3AdistributedKVStore.SingleKVStore:member=method%3Ainstance%3AputBatch:invoke=call:params=0%3AEntry%5B%5D%2C1%3AAsyncCallback%3Cvoid%3E:ret=void"
        ],
        "valueIndex": 0
    }
];

const rawReadCanonicalApiIds = [
    "api:official:openharmony:module=%40ohos.data.distributedData:file=api%2F%40ohos.data.distributedData.d.ts:export=namespace%3AdistributedData.DeviceKVStore:decl=interface%3AdistributedData.DeviceKVStore:member=method%3Ainstance%3Aget:invoke=call:params=0%3Astring%2C1%3Astring:ret=Promise%3Cboolean%20%7C%20string%20%7C%20number%20%7C%20Uint8Array%3E",
    "api:official:openharmony:module=%40ohos.data.distributedData:file=api%2F%40ohos.data.distributedData.d.ts:export=namespace%3AdistributedData.DeviceKVStore:decl=interface%3AdistributedData.DeviceKVStore:member=method%3Ainstance%3Aget:invoke=call:params=0%3Astring%2C1%3Astring%2C2%3AAsyncCallback%3Cboolean%20%7C%20string%20%7C%20number%20%7C%20Uint8Array%3E:ret=void",
    "api:official:openharmony:module=%40ohos.data.distributedData:file=api%2F%40ohos.data.distributedData.d.ts:export=namespace%3AdistributedData.DeviceKVStore:decl=interface%3AdistributedData.DeviceKVStore:member=method%3Ainstance%3AgetEntries:invoke=call:params=0%3AQuery:ret=Promise%3CEntry%5B%5D%3E",
    "api:official:openharmony:module=%40ohos.data.distributedData:file=api%2F%40ohos.data.distributedData.d.ts:export=namespace%3AdistributedData.DeviceKVStore:decl=interface%3AdistributedData.DeviceKVStore:member=method%3Ainstance%3AgetEntries:invoke=call:params=0%3AQuery%2C1%3AAsyncCallback%3CEntry%5B%5D%3E:ret=void",
    "api:official:openharmony:module=%40ohos.data.distributedData:file=api%2F%40ohos.data.distributedData.d.ts:export=namespace%3AdistributedData.DeviceKVStore:decl=interface%3AdistributedData.DeviceKVStore:member=method%3Ainstance%3AgetEntries:invoke=call:params=0%3Astring%2C1%3AQuery:ret=Promise%3CEntry%5B%5D%3E",
    "api:official:openharmony:module=%40ohos.data.distributedData:file=api%2F%40ohos.data.distributedData.d.ts:export=namespace%3AdistributedData.DeviceKVStore:decl=interface%3AdistributedData.DeviceKVStore:member=method%3Ainstance%3AgetEntries:invoke=call:params=0%3Astring%2C1%3AQuery%2C2%3AAsyncCallback%3CEntry%5B%5D%3E:ret=void",
    "api:official:openharmony:module=%40ohos.data.distributedData:file=api%2F%40ohos.data.distributedData.d.ts:export=namespace%3AdistributedData.DeviceKVStore:decl=interface%3AdistributedData.DeviceKVStore:member=method%3Ainstance%3AgetEntries:invoke=call:params=0%3Astring%2C1%3Astring:ret=Promise%3CEntry%5B%5D%3E",
    "api:official:openharmony:module=%40ohos.data.distributedData:file=api%2F%40ohos.data.distributedData.d.ts:export=namespace%3AdistributedData.DeviceKVStore:decl=interface%3AdistributedData.DeviceKVStore:member=method%3Ainstance%3AgetEntries:invoke=call:params=0%3Astring%2C1%3Astring%2C2%3AAsyncCallback%3CEntry%5B%5D%3E:ret=void",
    "api:official:openharmony:module=%40ohos.data.distributedData:file=api%2F%40ohos.data.distributedData.d.ts:export=namespace%3AdistributedData.SingleKVStore:decl=interface%3AdistributedData.SingleKVStore:member=method%3Ainstance%3Aget:invoke=call:params=0%3Astring:ret=Promise%3CUint8Array%20%7C%20string%20%7C%20boolean%20%7C%20number%3E",
    "api:official:openharmony:module=%40ohos.data.distributedData:file=api%2F%40ohos.data.distributedData.d.ts:export=namespace%3AdistributedData.SingleKVStore:decl=interface%3AdistributedData.SingleKVStore:member=method%3Ainstance%3Aget:invoke=call:params=0%3Astring%2C1%3AAsyncCallback%3CUint8Array%20%7C%20string%20%7C%20boolean%20%7C%20number%3E:ret=void",
    "api:official:openharmony:module=%40ohos.data.distributedData:file=api%2F%40ohos.data.distributedData.d.ts:export=namespace%3AdistributedData.SingleKVStore:decl=interface%3AdistributedData.SingleKVStore:member=method%3Ainstance%3AgetEntries:invoke=call:params=0%3AQuery:ret=Promise%3CEntry%5B%5D%3E",
    "api:official:openharmony:module=%40ohos.data.distributedData:file=api%2F%40ohos.data.distributedData.d.ts:export=namespace%3AdistributedData.SingleKVStore:decl=interface%3AdistributedData.SingleKVStore:member=method%3Ainstance%3AgetEntries:invoke=call:params=0%3AQuery%2C1%3AAsyncCallback%3CEntry%5B%5D%3E:ret=void",
    "api:official:openharmony:module=%40ohos.data.distributedData:file=api%2F%40ohos.data.distributedData.d.ts:export=namespace%3AdistributedData.SingleKVStore:decl=interface%3AdistributedData.SingleKVStore:member=method%3Ainstance%3AgetEntries:invoke=call:params=0%3Astring:ret=Promise%3CEntry%5B%5D%3E",
    "api:official:openharmony:module=%40ohos.data.distributedData:file=api%2F%40ohos.data.distributedData.d.ts:export=namespace%3AdistributedData.SingleKVStore:decl=interface%3AdistributedData.SingleKVStore:member=method%3Ainstance%3AgetEntries:invoke=call:params=0%3Astring%2C1%3AAsyncCallback%3CEntry%5B%5D%3E:ret=void",
    "api:official:openharmony:module=%40ohos.data.distributedKVStore:file=api%2F%40ohos.data.distributedKVStore.d.ts:export=namespace%3AdistributedKVStore.DeviceKVStore:decl=interface%3AdistributedKVStore.DeviceKVStore:member=method%3Ainstance%3Aget:invoke=call:params=0%3Astring:ret=Promise%3Cboolean%20%7C%20string%20%7C%20number%20%7C%20Uint8Array%3E",
    "api:official:openharmony:module=%40ohos.data.distributedKVStore:file=api%2F%40ohos.data.distributedKVStore.d.ts:export=namespace%3AdistributedKVStore.DeviceKVStore:decl=interface%3AdistributedKVStore.DeviceKVStore:member=method%3Ainstance%3Aget:invoke=call:params=0%3Astring%2C1%3AAsyncCallback%3Cboolean%20%7C%20string%20%7C%20number%20%7C%20Uint8Array%3E:ret=void",
    "api:official:openharmony:module=%40ohos.data.distributedKVStore:file=api%2F%40ohos.data.distributedKVStore.d.ts:export=namespace%3AdistributedKVStore.DeviceKVStore:decl=interface%3AdistributedKVStore.DeviceKVStore:member=method%3Ainstance%3Aget:invoke=call:params=0%3Astring%2C1%3Astring:ret=Promise%3Cboolean%20%7C%20string%20%7C%20number%20%7C%20Uint8Array%3E",
    "api:official:openharmony:module=%40ohos.data.distributedKVStore:file=api%2F%40ohos.data.distributedKVStore.d.ts:export=namespace%3AdistributedKVStore.DeviceKVStore:decl=interface%3AdistributedKVStore.DeviceKVStore:member=method%3Ainstance%3Aget:invoke=call:params=0%3Astring%2C1%3Astring%2C2%3AAsyncCallback%3Cboolean%20%7C%20string%20%7C%20number%20%7C%20Uint8Array%3E:ret=void",
    "api:official:openharmony:module=%40ohos.data.distributedKVStore:file=api%2F%40ohos.data.distributedKVStore.d.ts:export=namespace%3AdistributedKVStore.DeviceKVStore:decl=interface%3AdistributedKVStore.DeviceKVStore:member=method%3Ainstance%3AgetEntries:invoke=call:params=0%3AQuery:ret=Promise%3CEntry%5B%5D%3E",
    "api:official:openharmony:module=%40ohos.data.distributedKVStore:file=api%2F%40ohos.data.distributedKVStore.d.ts:export=namespace%3AdistributedKVStore.DeviceKVStore:decl=interface%3AdistributedKVStore.DeviceKVStore:member=method%3Ainstance%3AgetEntries:invoke=call:params=0%3AQuery%2C1%3AAsyncCallback%3CEntry%5B%5D%3E:ret=void",
    "api:official:openharmony:module=%40ohos.data.distributedKVStore:file=api%2F%40ohos.data.distributedKVStore.d.ts:export=namespace%3AdistributedKVStore.DeviceKVStore:decl=interface%3AdistributedKVStore.DeviceKVStore:member=method%3Ainstance%3AgetEntries:invoke=call:params=0%3Astring:ret=Promise%3CEntry%5B%5D%3E",
    "api:official:openharmony:module=%40ohos.data.distributedKVStore:file=api%2F%40ohos.data.distributedKVStore.d.ts:export=namespace%3AdistributedKVStore.DeviceKVStore:decl=interface%3AdistributedKVStore.DeviceKVStore:member=method%3Ainstance%3AgetEntries:invoke=call:params=0%3Astring%2C1%3AAsyncCallback%3CEntry%5B%5D%3E:ret=void",
    "api:official:openharmony:module=%40ohos.data.distributedKVStore:file=api%2F%40ohos.data.distributedKVStore.d.ts:export=namespace%3AdistributedKVStore.DeviceKVStore:decl=interface%3AdistributedKVStore.DeviceKVStore:member=method%3Ainstance%3AgetEntries:invoke=call:params=0%3Astring%2C1%3AQuery:ret=Promise%3CEntry%5B%5D%3E",
    "api:official:openharmony:module=%40ohos.data.distributedKVStore:file=api%2F%40ohos.data.distributedKVStore.d.ts:export=namespace%3AdistributedKVStore.DeviceKVStore:decl=interface%3AdistributedKVStore.DeviceKVStore:member=method%3Ainstance%3AgetEntries:invoke=call:params=0%3Astring%2C1%3AQuery%2C2%3AAsyncCallback%3CEntry%5B%5D%3E:ret=void",
    "api:official:openharmony:module=%40ohos.data.distributedKVStore:file=api%2F%40ohos.data.distributedKVStore.d.ts:export=namespace%3AdistributedKVStore.DeviceKVStore:decl=interface%3AdistributedKVStore.DeviceKVStore:member=method%3Ainstance%3AgetEntries:invoke=call:params=0%3Astring%2C1%3Astring:ret=Promise%3CEntry%5B%5D%3E",
    "api:official:openharmony:module=%40ohos.data.distributedKVStore:file=api%2F%40ohos.data.distributedKVStore.d.ts:export=namespace%3AdistributedKVStore.DeviceKVStore:decl=interface%3AdistributedKVStore.DeviceKVStore:member=method%3Ainstance%3AgetEntries:invoke=call:params=0%3Astring%2C1%3Astring%2C2%3AAsyncCallback%3CEntry%5B%5D%3E:ret=void",
    "api:official:openharmony:module=%40ohos.data.distributedKVStore:file=api%2F%40ohos.data.distributedKVStore.d.ts:export=namespace%3AdistributedKVStore.SingleKVStore:decl=interface%3AdistributedKVStore.SingleKVStore:member=method%3Ainstance%3Aget:invoke=call:params=0%3Astring:ret=Promise%3Cboolean%20%7C%20string%20%7C%20number%20%7C%20Uint8Array%3E",
    "api:official:openharmony:module=%40ohos.data.distributedKVStore:file=api%2F%40ohos.data.distributedKVStore.d.ts:export=namespace%3AdistributedKVStore.SingleKVStore:decl=interface%3AdistributedKVStore.SingleKVStore:member=method%3Ainstance%3Aget:invoke=call:params=0%3Astring%2C1%3AAsyncCallback%3Cboolean%20%7C%20string%20%7C%20number%20%7C%20Uint8Array%3E:ret=void",
    "api:official:openharmony:module=%40ohos.data.distributedKVStore:file=api%2F%40ohos.data.distributedKVStore.d.ts:export=namespace%3AdistributedKVStore.SingleKVStore:decl=interface%3AdistributedKVStore.SingleKVStore:member=method%3Ainstance%3AgetEntries:invoke=call:params=0%3AQuery:ret=Promise%3CEntry%5B%5D%3E",
    "api:official:openharmony:module=%40ohos.data.distributedKVStore:file=api%2F%40ohos.data.distributedKVStore.d.ts:export=namespace%3AdistributedKVStore.SingleKVStore:decl=interface%3AdistributedKVStore.SingleKVStore:member=method%3Ainstance%3AgetEntries:invoke=call:params=0%3AQuery%2C1%3AAsyncCallback%3CEntry%5B%5D%3E:ret=void",
    "api:official:openharmony:module=%40ohos.data.distributedKVStore:file=api%2F%40ohos.data.distributedKVStore.d.ts:export=namespace%3AdistributedKVStore.SingleKVStore:decl=interface%3AdistributedKVStore.SingleKVStore:member=method%3Ainstance%3AgetEntries:invoke=call:params=0%3Astring:ret=Promise%3CEntry%5B%5D%3E",
    "api:official:openharmony:module=%40ohos.data.distributedKVStore:file=api%2F%40ohos.data.distributedKVStore.d.ts:export=namespace%3AdistributedKVStore.SingleKVStore:decl=interface%3AdistributedKVStore.SingleKVStore:member=method%3Ainstance%3AgetEntries:invoke=call:params=0%3Astring%2C1%3AAsyncCallback%3CEntry%5B%5D%3E:ret=void",
    "api:official:openharmony:module=%40ohos.data.preferences:file=api%2F%40ohos.data.preferences.d.ts:export=namespace%3Apreferences.Preferences:decl=interface%3Apreferences.Preferences:member=method%3Ainstance%3Aget:invoke=call:params=0%3Astring%2C1%3AValueType:ret=Promise%3CValueType%3E",
    "api:official:openharmony:module=%40ohos.data.preferences:file=api%2F%40ohos.data.preferences.d.ts:export=namespace%3Apreferences.Preferences:decl=interface%3Apreferences.Preferences:member=method%3Ainstance%3Aget:invoke=call:params=0%3Astring%2C1%3AValueType%2C2%3AAsyncCallback%3CValueType%3E:ret=void",
    "api:official:openharmony:module=%40ohos.data.preferences:file=api%2F%40ohos.data.preferences.d.ts:export=namespace%3Apreferences.Preferences:decl=interface%3Apreferences.Preferences:member=method%3Ainstance%3AgetAll:invoke=call:params=0%3AAsyncCallback%3CObject%3E:ret=void",
    "api:official:openharmony:module=%40ohos.data.preferences:file=api%2F%40ohos.data.preferences.d.ts:export=namespace%3Apreferences.Preferences:decl=interface%3Apreferences.Preferences:member=method%3Ainstance%3AgetAll:invoke=call:params=none:ret=Promise%3CObject%3E",
    "api:official:openharmony:module=%40ohos.data.preferences:file=api%2F%40ohos.data.preferences.d.ts:export=namespace%3Apreferences.Preferences:decl=interface%3Apreferences.Preferences:member=method%3Ainstance%3AgetAllSync:invoke=call:params=none:ret=Object",
    "api:official:openharmony:module=%40ohos.data.preferences:file=api%2F%40ohos.data.preferences.d.ts:export=namespace%3Apreferences.Preferences:decl=interface%3Apreferences.Preferences:member=method%3Ainstance%3AgetSync:invoke=call:params=0%3Astring%2C1%3AValueType:ret=ValueType",
    "api:official:openharmony:module=%40ohos.data.sendablePreferences:file=api%2F%40ohos.data.sendablePreferences.d.ets:export=namespace%3AsendablePreferences.Preferences:decl=interface%3AsendablePreferences.Preferences:member=method%3Ainstance%3Aget:invoke=call:params=0%3Astring%2C1%3Alang.ISendable:ret=Promise%3Clang.ISendable%3E",
    "api:official:openharmony:module=%40ohos.data.sendablePreferences:file=api%2F%40ohos.data.sendablePreferences.d.ets:export=namespace%3AsendablePreferences.Preferences:decl=interface%3AsendablePreferences.Preferences:member=method%3Ainstance%3AgetAll:invoke=call:params=none:ret=Promise%3Clang.ISendable%3E",
    "api:official:openharmony:module=%40ohos.data.sendablePreferences:file=api%2F%40ohos.data.sendablePreferences.d.ets:export=namespace%3AsendablePreferences.Preferences:decl=interface%3AsendablePreferences.Preferences:member=method%3Ainstance%3AgetAllSync:invoke=call:params=none:ret=lang.ISendable",
    "api:official:openharmony:module=%40ohos.data.sendablePreferences:file=api%2F%40ohos.data.sendablePreferences.d.ets:export=namespace%3AsendablePreferences.Preferences:decl=interface%3AsendablePreferences.Preferences:member=method%3Ainstance%3AgetSync:invoke=call:params=0%3Astring%2C1%3Alang.ISendable:ret=lang.ISendable",
    "api:official:arkui:module=api%2Farkui%2FstateManagement%2Fstorages%2FappStorage.d.ets:file=api%2Farkui%2FstateManagement%2Fstorages%2FappStorage.d.ets:export=named%3AAppStorage:decl=class%3AAppStorage:member=method%3Astatic%3Aget:invoke=call:params=0%3Astring:ret=T%20%7C%20undefined",
    "api:official:arkui:module=api%2Farkui%2FstateManagement%2Fstorages%2FappStorage.d.ets:file=api%2Farkui%2FstateManagement%2Fstorages%2FappStorage.d.ets:export=named%3AAppStorage:decl=class%3AAppStorage:member=method%3Astatic%3Alink:invoke=call:params=0%3Astring:ret=SubscribedAbstractProperty%3CT%3E%20%7C%20undefined",
    "api:official:arkui:module=api%2Farkui%2FstateManagement%2Fstorages%2FappStorage.d.ets:file=api%2Farkui%2FstateManagement%2Fstorages%2FappStorage.d.ets:export=named%3AAppStorage:decl=class%3AAppStorage:member=method%3Astatic%3Aprop:invoke=call:params=0%3Astring:ret=SubscribedAbstractProperty%3CT%3E%20%7C%20undefined",
    "api:official:arkui:module=api%2Farkui%2FstateManagement%2Fstorages%2FappStorage.d.ets:file=api%2Farkui%2FstateManagement%2Fstorages%2FappStorage.d.ets:export=named%3AAppStorage:decl=class%3AAppStorage:member=method%3Astatic%3Aref:invoke=call:params=0%3Astring:ret=AbstractProperty%3CT%3E%20%7C%20undefined",
    "api:official:arkui:module=api%2Farkui%2FstateManagement%2Fstorages%2FlocalStorage.d.ets:file=api%2Farkui%2FstateManagement%2Fstorages%2FlocalStorage.d.ets:export=named%3ALocalStorage:decl=class%3ALocalStorage:member=method%3Ainstance%3Aget:invoke=call:params=0%3Astring:ret=T%20%7C%20undefined",
    "api:official:arkui:module=api%2Farkui%2FstateManagement%2Fstorages%2FlocalStorage.d.ets:file=api%2Farkui%2FstateManagement%2Fstorages%2FlocalStorage.d.ets:export=named%3ALocalStorage:decl=class%3ALocalStorage:member=method%3Ainstance%3Alink:invoke=call:params=0%3Astring:ret=SubscribedAbstractProperty%3CT%3E%20%7C%20undefined",
    "api:official:arkui:module=api%2Farkui%2FstateManagement%2Fstorages%2FlocalStorage.d.ets:file=api%2Farkui%2FstateManagement%2Fstorages%2FlocalStorage.d.ets:export=named%3ALocalStorage:decl=class%3ALocalStorage:member=method%3Ainstance%3Aprop:invoke=call:params=0%3Astring:ret=SubscribedAbstractProperty%3CT%3E%20%7C%20undefined",
    "api:official:arkui:module=api%2Farkui%2FstateManagement%2Fstorages%2FlocalStorage.d.ets:file=api%2Farkui%2FstateManagement%2Fstorages%2FlocalStorage.d.ets:export=named%3ALocalStorage:decl=class%3ALocalStorage:member=method%3Ainstance%3Aref:invoke=call:params=0%3Astring:ret=AbstractProperty%3CT%3E%20%7C%20undefined",
];

const rawKillCanonicalApiIds = [
    "api:official:openharmony:module=%40ohos.data.distributedData:file=api%2F%40ohos.data.distributedData.d.ts:export=namespace%3AdistributedData.DeviceKVStore:decl=interface%3AdistributedData.DeviceKVStore:member=method%3Ainstance%3AremoveDeviceData:invoke=call:params=0%3Astring:ret=Promise%3Cvoid%3E",
    "api:official:openharmony:module=%40ohos.data.distributedData:file=api%2F%40ohos.data.distributedData.d.ts:export=namespace%3AdistributedData.DeviceKVStore:decl=interface%3AdistributedData.DeviceKVStore:member=method%3Ainstance%3AremoveDeviceData:invoke=call:params=0%3Astring%2C1%3AAsyncCallback%3Cvoid%3E:ret=void",
    "api:official:openharmony:module=%40ohos.data.distributedData:file=api%2F%40ohos.data.distributedData.d.ts:export=namespace%3AdistributedData.KVManager:decl=interface%3AdistributedData.KVManager:member=method%3Ainstance%3AdeleteKVStore:invoke=call:params=0%3Astring%2C1%3Astring:ret=Promise%3Cvoid%3E",
    "api:official:openharmony:module=%40ohos.data.distributedData:file=api%2F%40ohos.data.distributedData.d.ts:export=namespace%3AdistributedData.KVManager:decl=interface%3AdistributedData.KVManager:member=method%3Ainstance%3AdeleteKVStore:invoke=call:params=0%3Astring%2C1%3Astring%2C2%3AAsyncCallback%3Cvoid%3E:ret=void",
    "api:official:openharmony:module=%40ohos.data.distributedData:file=api%2F%40ohos.data.distributedData.d.ts:export=namespace%3AdistributedData.KVStore:decl=interface%3AdistributedData.KVStore:member=method%3Ainstance%3Adelete:invoke=call:params=0%3Astring:ret=Promise%3Cvoid%3E",
    "api:official:openharmony:module=%40ohos.data.distributedData:file=api%2F%40ohos.data.distributedData.d.ts:export=namespace%3AdistributedData.KVStore:decl=interface%3AdistributedData.KVStore:member=method%3Ainstance%3Adelete:invoke=call:params=0%3Astring%2C1%3AAsyncCallback%3Cvoid%3E:ret=void",
    "api:official:openharmony:module=%40ohos.data.distributedData:file=api%2F%40ohos.data.distributedData.d.ts:export=namespace%3AdistributedData.KVStore:decl=interface%3AdistributedData.KVStore:member=method%3Ainstance%3AdeleteBatch:invoke=call:params=0%3Astring%5B%5D:ret=Promise%3Cvoid%3E",
    "api:official:openharmony:module=%40ohos.data.distributedData:file=api%2F%40ohos.data.distributedData.d.ts:export=namespace%3AdistributedData.KVStore:decl=interface%3AdistributedData.KVStore:member=method%3Ainstance%3AdeleteBatch:invoke=call:params=0%3Astring%5B%5D%2C1%3AAsyncCallback%3Cvoid%3E:ret=void",
    "api:official:openharmony:module=%40ohos.data.distributedData:file=api%2F%40ohos.data.distributedData.d.ts:export=namespace%3AdistributedData.SingleKVStore:decl=interface%3AdistributedData.SingleKVStore:member=method%3Ainstance%3AremoveDeviceData:invoke=call:params=0%3Astring:ret=Promise%3Cvoid%3E",
    "api:official:openharmony:module=%40ohos.data.distributedData:file=api%2F%40ohos.data.distributedData.d.ts:export=namespace%3AdistributedData.SingleKVStore:decl=interface%3AdistributedData.SingleKVStore:member=method%3Ainstance%3AremoveDeviceData:invoke=call:params=0%3Astring%2C1%3AAsyncCallback%3Cvoid%3E:ret=void",
    "api:official:openharmony:module=%40ohos.data.distributedKVStore:file=api%2F%40ohos.data.distributedKVStore.d.ts:export=namespace%3AdistributedKVStore.KVManager:decl=interface%3AdistributedKVStore.KVManager:member=method%3Ainstance%3AdeleteKVStore:invoke=call:params=0%3Astring%2C1%3Astring:ret=Promise%3Cvoid%3E",
    "api:official:openharmony:module=%40ohos.data.distributedKVStore:file=api%2F%40ohos.data.distributedKVStore.d.ts:export=namespace%3AdistributedKVStore.KVManager:decl=interface%3AdistributedKVStore.KVManager:member=method%3Ainstance%3AdeleteKVStore:invoke=call:params=0%3Astring%2C1%3Astring%2C2%3AAsyncCallback%3Cvoid%3E:ret=void",
    "api:official:openharmony:module=%40ohos.data.distributedKVStore:file=api%2F%40ohos.data.distributedKVStore.d.ts:export=namespace%3AdistributedKVStore.SingleKVStore:decl=interface%3AdistributedKVStore.SingleKVStore:member=method%3Ainstance%3Adelete:invoke=call:params=0%3AdataSharePredicates.DataSharePredicates:ret=Promise%3Cvoid%3E",
    "api:official:openharmony:module=%40ohos.data.distributedKVStore:file=api%2F%40ohos.data.distributedKVStore.d.ts:export=namespace%3AdistributedKVStore.SingleKVStore:decl=interface%3AdistributedKVStore.SingleKVStore:member=method%3Ainstance%3Adelete:invoke=call:params=0%3AdataSharePredicates.DataSharePredicates%2C1%3AAsyncCallback%3Cvoid%3E:ret=void",
    "api:official:openharmony:module=%40ohos.data.distributedKVStore:file=api%2F%40ohos.data.distributedKVStore.d.ts:export=namespace%3AdistributedKVStore.SingleKVStore:decl=interface%3AdistributedKVStore.SingleKVStore:member=method%3Ainstance%3Adelete:invoke=call:params=0%3Astring:ret=Promise%3Cvoid%3E",
    "api:official:openharmony:module=%40ohos.data.distributedKVStore:file=api%2F%40ohos.data.distributedKVStore.d.ts:export=namespace%3AdistributedKVStore.SingleKVStore:decl=interface%3AdistributedKVStore.SingleKVStore:member=method%3Ainstance%3Adelete:invoke=call:params=0%3Astring%2C1%3AAsyncCallback%3Cvoid%3E:ret=void",
    "api:official:openharmony:module=%40ohos.data.distributedKVStore:file=api%2F%40ohos.data.distributedKVStore.d.ts:export=namespace%3AdistributedKVStore.SingleKVStore:decl=interface%3AdistributedKVStore.SingleKVStore:member=method%3Ainstance%3AdeleteBatch:invoke=call:params=0%3Astring%5B%5D:ret=Promise%3Cvoid%3E",
    "api:official:openharmony:module=%40ohos.data.distributedKVStore:file=api%2F%40ohos.data.distributedKVStore.d.ts:export=namespace%3AdistributedKVStore.SingleKVStore:decl=interface%3AdistributedKVStore.SingleKVStore:member=method%3Ainstance%3AdeleteBatch:invoke=call:params=0%3Astring%5B%5D%2C1%3AAsyncCallback%3Cvoid%3E:ret=void",
    "api:official:openharmony:module=%40ohos.data.distributedKVStore:file=api%2F%40ohos.data.distributedKVStore.d.ts:export=namespace%3AdistributedKVStore.SingleKVStore:decl=interface%3AdistributedKVStore.SingleKVStore:member=method%3Ainstance%3AremoveDeviceData:invoke=call:params=0%3Astring:ret=Promise%3Cvoid%3E",
    "api:official:openharmony:module=%40ohos.data.distributedKVStore:file=api%2F%40ohos.data.distributedKVStore.d.ts:export=namespace%3AdistributedKVStore.SingleKVStore:decl=interface%3AdistributedKVStore.SingleKVStore:member=method%3Ainstance%3AremoveDeviceData:invoke=call:params=0%3Astring%2C1%3AAsyncCallback%3Cvoid%3E:ret=void",
    "api:official:openharmony:module=%40ohos.data.preferences:file=api%2F%40ohos.data.preferences.d.ts:export=namespace%3Apreferences.Preferences:decl=interface%3Apreferences.Preferences:member=method%3Ainstance%3Aclear:invoke=call:params=0%3AAsyncCallback%3Cvoid%3E:ret=void",
    "api:official:openharmony:module=%40ohos.data.preferences:file=api%2F%40ohos.data.preferences.d.ts:export=namespace%3Apreferences.Preferences:decl=interface%3Apreferences.Preferences:member=method%3Ainstance%3Aclear:invoke=call:params=none:ret=Promise%3Cvoid%3E",
    "api:official:openharmony:module=%40ohos.data.preferences:file=api%2F%40ohos.data.preferences.d.ts:export=namespace%3Apreferences.Preferences:decl=interface%3Apreferences.Preferences:member=method%3Ainstance%3AclearSync:invoke=call:params=none:ret=void",
    "api:official:openharmony:module=%40ohos.data.preferences:file=api%2F%40ohos.data.preferences.d.ts:export=namespace%3Apreferences.Preferences:decl=interface%3Apreferences.Preferences:member=method%3Ainstance%3Adelete:invoke=call:params=0%3Astring:ret=Promise%3Cvoid%3E",
    "api:official:openharmony:module=%40ohos.data.preferences:file=api%2F%40ohos.data.preferences.d.ts:export=namespace%3Apreferences.Preferences:decl=interface%3Apreferences.Preferences:member=method%3Ainstance%3Adelete:invoke=call:params=0%3Astring%2C1%3AAsyncCallback%3Cvoid%3E:ret=void",
    "api:official:openharmony:module=%40ohos.data.preferences:file=api%2F%40ohos.data.preferences.d.ts:export=namespace%3Apreferences.Preferences:decl=interface%3Apreferences.Preferences:member=method%3Ainstance%3AdeleteSync:invoke=call:params=0%3Astring:ret=void",
    "api:official:openharmony:module=%40ohos.data.sendablePreferences:file=api%2F%40ohos.data.sendablePreferences.d.ets:export=namespace%3AsendablePreferences.Preferences:decl=interface%3AsendablePreferences.Preferences:member=method%3Ainstance%3Aclear:invoke=call:params=none:ret=Promise%3Cvoid%3E",
    "api:official:openharmony:module=%40ohos.data.sendablePreferences:file=api%2F%40ohos.data.sendablePreferences.d.ets:export=namespace%3AsendablePreferences.Preferences:decl=interface%3AsendablePreferences.Preferences:member=method%3Ainstance%3AclearSync:invoke=call:params=none:ret=void",
    "api:official:openharmony:module=%40ohos.data.sendablePreferences:file=api%2F%40ohos.data.sendablePreferences.d.ets:export=namespace%3AsendablePreferences.Preferences:decl=interface%3AsendablePreferences.Preferences:member=method%3Ainstance%3Adelete:invoke=call:params=0%3Astring:ret=Promise%3Cvoid%3E",
    "api:official:openharmony:module=%40ohos.data.sendablePreferences:file=api%2F%40ohos.data.sendablePreferences.d.ets:export=namespace%3AsendablePreferences.Preferences:decl=interface%3AsendablePreferences.Preferences:member=method%3Ainstance%3AdeleteSync:invoke=call:params=0%3Astring:ret=void",
    "api:official:arkui:module=api%2Farkui%2FstateManagement%2Fstorages%2FappStorage.d.ets:file=api%2Farkui%2FstateManagement%2Fstorages%2FappStorage.d.ets:export=named%3AAppStorage:decl=class%3AAppStorage:member=method%3Astatic%3Aclear:invoke=call:params=none:ret=boolean",
    "api:official:arkui:module=api%2Farkui%2FstateManagement%2Fstorages%2FappStorage.d.ets:file=api%2Farkui%2FstateManagement%2Fstorages%2FappStorage.d.ets:export=named%3AAppStorage:decl=class%3AAppStorage:member=method%3Astatic%3Adelete:invoke=call:params=0%3Astring:ret=boolean",
    "api:official:arkui:module=api%2Farkui%2FstateManagement%2Fstorages%2FlocalStorage.d.ets:file=api%2Farkui%2FstateManagement%2Fstorages%2FlocalStorage.d.ets:export=named%3ALocalStorage:decl=class%3ALocalStorage:member=method%3Ainstance%3Aclear:invoke=call:params=none:ret=boolean",
    "api:official:arkui:module=api%2Farkui%2FstateManagement%2Fstorages%2FlocalStorage.d.ets:file=api%2Farkui%2FstateManagement%2Fstorages%2FlocalStorage.d.ets:export=named%3ALocalStorage:decl=class%3ALocalStorage:member=method%3Ainstance%3Adelete:invoke=call:params=0%3Astring:ret=boolean",
];

function decodedCanonicalApiId(canonicalApiId: string): string {
    return decodeURIComponent(canonicalApiId);
}

function canonicalMemberName(canonicalApiId: string): string {
    const decoded = decodedCanonicalApiId(canonicalApiId);
    const match = decoded.match(/:member=([^:]+(?::[^:]+){0,2}):invoke=/);
    const member = match ? match[1] : "";
    const parts = member.split(":");
    return parts[parts.length - 1] || "";
}

function canonicalDecl(canonicalApiId: string): string {
    const decoded = decodedCanonicalApiId(canonicalApiId);
    const match = decoded.match(/:decl=([^:]+(?::[^:]+){0,1}):member=/);
    return match ? match[1] : "";
}

function canonicalParameterTypes(canonicalApiId: string): string[] {
    const decoded = decodedCanonicalApiId(canonicalApiId);
    const match = decoded.match(/:params=(.*):ret=/);
    if (!match || match[1] === "none") return [];
    return match[1].split(",").map(part => {
        const separator = part.lastIndexOf(":");
        return separator >= 0 ? part.slice(separator + 1).trim() : "";
    });
}

function isSingleKeyWrite(canonicalApiId: string): boolean {
    const member = canonicalMemberName(canonicalApiId);
    if (member === "putBatch") return false;
    if (member === "setAndRef" || member === "setAndLink" || member === "setAndProp") return false;
    const params = canonicalParameterTypes(canonicalApiId);
    return params[0] === "string";
}

function isSingleKeyWriteResult(canonicalApiId: string): boolean {
    const member = canonicalMemberName(canonicalApiId);
    if (member !== "setAndRef" && member !== "setAndLink" && member !== "setAndProp") return false;
    const params = canonicalParameterTypes(canonicalApiId);
    return params[0] === "string" && params.length >= 2;
}

function isSingleKeyRead(canonicalApiId: string): boolean {
    const member = canonicalMemberName(canonicalApiId);
    if (member === "getEntries" || member === "getAll" || member === "getAllSync") return false;
    if (canonicalDecl(canonicalApiId).includes("DeviceKVStore")) return false;
    const params = canonicalParameterTypes(canonicalApiId);
    return params[0] === "string";
}

function isSingleKeyKill(canonicalApiId: string): boolean {
    const member = canonicalMemberName(canonicalApiId);
    if (member !== "delete" && member !== "deleteSync") return false;
    const params = canonicalParameterTypes(canonicalApiId);
    return params[0] === "string";
}

const writeApis = rawWriteApis
    .map(api => ({
        ...api,
        canonicalApiIds: api.canonicalApiIds.filter(isSingleKeyWrite),
    }))
    .filter(api => api.canonicalApiIds.length > 0);

const writeResultApis = rawWriteApis
    .map(api => ({
        ...api,
        canonicalApiIds: api.canonicalApiIds.filter(isSingleKeyWriteResult),
        updateStrength: "weak" as const,
    }))
    .filter(api => api.canonicalApiIds.length > 0);

const readCanonicalApiIds = rawReadCanonicalApiIds.filter(isSingleKeyRead);
const killCanonicalApiIds = rawKillCanonicalApiIds.filter(isSingleKeyKill);

const harmonyAppStorageModuleAsset = createBuiltinModuleAsset({
    id: "harmony.appstorage",
    description: "Built-in Harmony keyed storage handoff semantics.",
    semanticsFamily: "harmony-keyed-storage",
    role: "handoff",
    capability: "module.keyed-storage",
    surfaces: [
        ...[
            ...writeApis.flatMap(api => api.canonicalApiIds),
            ...writeResultApis.flatMap(api => api.canonicalApiIds),
            ...readCanonicalApiIds,
            ...killCanonicalApiIds,
        ].map(officialInvokeSurfaceFromId),
        ...[
            ...propDecoratorCanonicalApiIds,
            ...linkDecoratorCanonicalApiIds,
        ].map(officialDecoratorSurfaceFromId),
    ],
    payload: {
        writeApis,
        writeResultApis,
        readCanonicalApiIds,
        killCanonicalApiIds,
        propDecoratorCanonicalApiIds,
        linkDecoratorCanonicalApiIds,
    },
});

export default harmonyAppStorageModuleAsset;
