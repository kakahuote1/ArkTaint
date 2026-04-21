import HashMap from "@ohos.util.HashMap";
import { taint } from "./taint_mock";

export function hashmap_set_get_010_F(taint_src: string): void {
    const m = new HashMap<string, string>();
    m.set("token", taint_src);
    m.set("other", "clean");
    taint.Sink(m.get("other"));
}
