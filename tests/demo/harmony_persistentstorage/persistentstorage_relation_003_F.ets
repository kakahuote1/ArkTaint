import { AppStorage, PersistentStorage, taint } from "./taint_mock";

export function persistentstorage_relation_003_F(taint_src: string): void {
    PersistentStorage.persistProp("unsafe_key", taint_src);
    const safeRead = AppStorage.get("safe_key");
    taint.Sink(safeRead);
}

