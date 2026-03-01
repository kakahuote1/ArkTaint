import { LocalStorage, taint } from "./taint_mock";

export function localstorage_dynamic_same_007_T(taint_src: string): void {
    const k = "token";
    LocalStorage.set(k, taint_src);
    const loaded = LocalStorage.get(k);
    taint.Sink(loaded);
}

