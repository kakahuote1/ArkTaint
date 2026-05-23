import { AppStorage, taint } from "./taint_mock";

export function appstorage_api_clean_overwrite_018_F(taint_src: string): void {
    AppStorage.set("token", taint_src);
    AppStorage.set("token", "safe");
    const out = AppStorage.get("token");
    taint.Sink(out);
}
