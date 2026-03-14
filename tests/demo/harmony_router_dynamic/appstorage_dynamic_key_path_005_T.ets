import { AppStorage, taint } from "./taint_mock";

function keyByInput(v: string): string {
    return v.length > 2 ? "token" : "safe";
}

export function appstorage_dynamic_key_path_005_T(taint_src: string): void {
    const key = keyByInput(taint_src);
    AppStorage.set(key, taint_src);
    const out = AppStorage.get("token");
    taint.Sink(out);
}

