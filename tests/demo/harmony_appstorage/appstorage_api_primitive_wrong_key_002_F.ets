import { AppStorage, taint } from "./taint_mock";

export function appstorage_api_primitive_wrong_key_002_F(taint_src: string): void {
    AppStorage.set("token", taint_src);
    const out = AppStorage.get("safe");
    taint.Sink(out);
}
