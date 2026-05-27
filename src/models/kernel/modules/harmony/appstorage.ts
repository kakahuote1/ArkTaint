import { createBuiltinModuleAsset, decoratorSurface, moduleInvokeSurface } from "../../moduleAssetHelpers";

const storageClasses = ["AppStorage", "LocalStorage", "PersistentStorage"];
const writeMethods = [
    { methodName: "set", valueIndex: 1 },
    { methodName: "setOrCreate", valueIndex: 1 },
    { methodName: "persistProp", valueIndex: 1 },
];
const readMethods = ["get", "prop", "link", "setOrCreate"];

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
        propDecorators: ["StorageProp", "LocalStorageProp"],
        linkDecorators: ["StorageLink", "LocalStorageLink"],
    },
});

export default harmonyAppStorageModuleAsset;
