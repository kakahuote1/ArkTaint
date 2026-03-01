import { AppStorage, taint } from "./taint_mock";

export function appstorage_api_primitive_set_get_001_T(taint_src: string): void {
    AppStorage.set("token", taint_src);
    const out = AppStorage.get("token");
    taint.Sink(out);
}
