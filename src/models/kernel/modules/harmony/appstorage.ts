import { createBuiltinModuleAsset, decoratorSurface, moduleInvokeSurface } from "../../moduleAssetHelpers";

const storageClasses = [
    "AppStorage",
    "LocalStorage",
    "PersistentStorage",
    "Preferences",
    "SendablePreferences",
    "KVStore",
    "SingleKVStore",
    "DeviceKVStore",
    "DistributedKVStore",
];
const writeMethods = [
    { methodName: "set", valueIndex: 1 },
    { methodName: "setOrCreate", valueIndex: 1 },
    { methodName: "persistProp", valueIndex: 1 },
    { methodName: "put", valueIndex: 1 },
    { methodName: "putBatch", valueIndex: 0 },
    { methodName: "putSync", valueIndex: 1 },
];
const readMethods = [
    "get",
    "getSync",
    "getEntries",
    "getEntriesSync",
    "prop",
    "link",
    "setOrCreate",
];
const killMethods = [
    "delete",
    "deleteSync",
    "remove",
    "removeSync",
    "deleteKey",
    "deleteItem",
];

const harmonyAppStorageModuleAsset = createBuiltinModuleAsset({
    id: "harmony.appstorage",
    description: "Built-in Harmony keyed storage handoff semantics.",
    semanticsFamily: "harmony-keyed-storage",
    role: "handoff",
    capability: "module.keyed-storage",
    surfaces: [
        ...storageClasses.flatMap(owner => [
            ...writeMethods.map(method => moduleInvokeSurface(
                `harmony.appstorage.${owner}.${method.methodName}`,
                owner,
                method.methodName,
                method.methodName === "persistProp" ? 3 : 2,
            )),
            ...readMethods.filter(method => !writeMethods.some(write => write.methodName === method)).map(method => moduleInvokeSurface(
                `harmony.appstorage.${owner}.${method}`,
                owner,
                method,
                method === "setOrCreate" ? 2 : 1,
            )),
            ...killMethods.map(method => moduleInvokeSurface(
                `harmony.appstorage.${owner}.${method}`,
                owner,
                method,
                1,
            )),
        ]),
        decoratorSurface("harmony.appstorage.decorator.StorageProp", "StorageProp"),
        decoratorSurface("harmony.appstorage.decorator.LocalStorageProp", "LocalStorageProp"),
        decoratorSurface("harmony.appstorage.decorator.StorageLink", "StorageLink"),
        decoratorSurface("harmony.appstorage.decorator.LocalStorageLink", "LocalStorageLink"),
    ],
    payload: {
        storageClasses,
        writeMethods,
        readMethods,
        killMethods,
        propDecorators: ["StorageProp", "LocalStorageProp"],
        linkDecorators: ["StorageLink", "LocalStorageLink"],
    },
});

export default harmonyAppStorageModuleAsset;
