import { AppStorage, taint } from "./taint_mock";

export function appstorage_api_setorcreate_then_get_013_T(taint_src: string): void {
    const created = AppStorage.setOrCreate("token", taint_src);
    const out = AppStorage.get("token");
    taint.Sink(created);
    taint.Sink(out);
}

