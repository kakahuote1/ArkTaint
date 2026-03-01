import { AppStorage, taint } from "./taint_mock";

function chooseKey(flag: boolean): string {
    return flag ? "token" : "safe";
}

export function appstorage_api_dynamic_mismatch_locals_017_F(taint_src: string): void {
    const kSet = chooseKey(taint_src.length > 0);
    const kGet = chooseKey(false);
    AppStorage.set(kSet, taint_src);
    const out = AppStorage.get(kGet);
    taint.Sink(out);
}
