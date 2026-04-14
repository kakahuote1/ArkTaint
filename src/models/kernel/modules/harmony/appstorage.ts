import type { ModuleSpec } from "../../../../core/kernel/contracts/ModuleSpec";

const harmonyAppStorageModuleSpec: ModuleSpec = {
    id: "harmony.appstorage",
    semantics: [
        {
            kind: "keyed_storage",
            storageClasses: [
                "AppStorage",
                "LocalStorage",
                "PersistentStorage",
            ],
            writeMethods: [
                { methodName: "set", valueIndex: 1 },
                { methodName: "setOrCreate", valueIndex: 1 },
                { methodName: "persistProp", valueIndex: 1 },
            ],
            readMethods: [
                "get",
                "prop",
                "link",
                "setOrCreate",
            ],
            propDecorators: [
                "StorageProp",
                "LocalStorageProp",
            ],
            linkDecorators: [
                "StorageLink",
                "LocalStorageLink",
            ],
        },
    ],
};

export default harmonyAppStorageModuleSpec;

