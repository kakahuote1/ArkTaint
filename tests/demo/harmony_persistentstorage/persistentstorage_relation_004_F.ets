import { AppStorage, PersistentStorage, taint } from "./taint_mock";

export function persistentstorage_relation_004_F(taint_src: string): void {
    AppStorage.set("k1", taint_src);
    const mismatch = PersistentStorage.get("k2");
    taint.Sink(mismatch);
}

