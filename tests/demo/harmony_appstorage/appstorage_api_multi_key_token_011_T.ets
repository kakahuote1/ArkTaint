import { AppStorage, taint } from "./taint_mock";

export function appstorage_api_multi_key_token_011_T(taint_src: string): void {
    AppStorage.set("safe", "const");
    AppStorage.set("token", taint_src);
    const out = AppStorage.get("token");
    taint.Sink(out);
}

