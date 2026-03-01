import { AppStorage, taint } from "./taint_mock";

function chooseKey(flag: boolean): string {
    return flag ? "token" : "safe";
}

export function appstorage_api_dynamic_same_local_016_T(taint_src: string): void {
    const k = chooseKey(taint_src.length > 0);
    AppStorage.set(k, taint_src);
    const out = AppStorage.get(k);
    taint.Sink(out);
}
