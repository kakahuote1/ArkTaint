import { AppStorage, PersistentStorage, taint } from "./taint_mock";

export function persistentstorage_relation_001_T(taint_src: string): void {
    PersistentStorage.persistProp("token", taint_src);
    const fromApp = AppStorage.get("token");
    taint.Sink(fromApp);
}

