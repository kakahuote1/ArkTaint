import { AppStorage, taint, Payload } from "./taint_mock";

export function appstorage_api_object_set_get_005_T(taint_src: Payload): void {
    AppStorage.set("obj", taint_src);
    const out = AppStorage.get("obj") as Payload;
    taint.Sink(out);
}
