import { readShared } from "./store";
import { taint } from "./taint_mock";

export function taintmain_context_pollute_sink_002_F(clean_src: string): void {
    const shadow = clean_src;
    if (shadow === "__never__") {
        console.log(shadow);
    }
    const value = readShared();
    taint.Sink(value);
}
