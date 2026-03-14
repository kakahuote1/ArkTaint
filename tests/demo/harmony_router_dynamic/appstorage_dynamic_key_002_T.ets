import { AppStorage, taint } from "./taint_mock";

function chooseKey(input: string): string {
    return input.length > 1 ? "token" : "safe";
}

export function appstorage_dynamic_key_002_T(taint_src: string): void {
    const k = chooseKey(taint_src);
    AppStorage.set(k, taint_src);
    const out = AppStorage.get("token");
    taint.Sink(out);
}
