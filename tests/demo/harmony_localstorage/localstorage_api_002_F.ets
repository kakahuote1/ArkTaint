import { LocalStorage, taint } from "./taint_mock";

export function localstorage_api_002_F(taint_src: string): void {
    LocalStorage.set("token", taint_src);
    const loaded = LocalStorage.get("safe");
    taint.Sink(loaded);
}

