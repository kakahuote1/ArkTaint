import Vector from "@ohos.util.Vector";
import { taint } from "./taint_mock";

export function vector_add_get_001_T(taint_src: string): void {
    const v = new Vector<string>();
    v.add(taint_src);
    v.add("clean");
    taint.Sink(v.get(0));
}
