import { AppStorage, PersistentStorage, taint } from "./taint_mock";

export function persistentstorage_relation_002_T(taint_src: string): void {
    AppStorage.set("session", taint_src);
    const fromPersistent = PersistentStorage.get("session");
    taint.Sink(fromPersistent);
}

