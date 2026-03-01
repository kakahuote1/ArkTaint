import { LocalStorage, taint } from "./taint_mock";

export function localstorage_dynamic_mismatch_008_F(taint_src: string): void {
    const writeKey = "token";
    const readKey = "safe";
    LocalStorage.set(writeKey, taint_src);
    const loaded = LocalStorage.get(readKey);
    taint.Sink(loaded);
}

