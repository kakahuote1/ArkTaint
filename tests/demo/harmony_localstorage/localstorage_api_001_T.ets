import { LocalStorage, taint } from "./taint_mock";

export function localstorage_api_001_T(taint_src: string): void {
    LocalStorage.set("token", taint_src);
    const loaded = LocalStorage.get("token");
    taint.Sink(loaded);
}

