import { AppStorage, taint } from "./taint_mock";

export function appstorage_api_multi_key_mismatch_012_F(taint_src: string): void {
    AppStorage.set("token_shadow", taint_src);
    AppStorage.set("safe", "const");
    const out = AppStorage.get("token");
    taint.Sink(out);
}

