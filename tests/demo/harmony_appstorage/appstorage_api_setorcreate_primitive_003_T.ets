import { AppStorage, taint } from "./taint_mock";

export function appstorage_api_setorcreate_primitive_003_T(taint_src: string): void {
    AppStorage.setOrCreate("token", taint_src);
    const out = AppStorage.get("token");
    taint.Sink(out);
}
