import { AppStorage, taint } from "./taint_mock";

function chooseKey(flag: boolean): string {
    return flag ? "token" : "safe";
}

export function appstorage_api_dynamic_key_004_F(taint_src: string): void {
    const k = chooseKey(false);
    AppStorage.set(k, taint_src);
    const out = AppStorage.get("token");
    taint.Sink(out);
}
