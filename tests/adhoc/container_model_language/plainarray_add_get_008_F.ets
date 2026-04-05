import PlainArray from "@ohos.util.PlainArray";
import { taint } from "./taint_mock";

export function plainarray_add_get_008_F(taint_src: string): void {
    const p = new PlainArray<string>();
    p.add(1, taint_src);
    p.add(2, "clean");
    taint.Sink(p.get(2));
}
