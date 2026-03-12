import { readShared } from "./store";
import { taint } from "./taint_mock";

function bridgeRead(): string {
    const tmp = readShared();
    return tmp;
}

export function taintmain_context_pollute_sink_via_helper_003_F(clean_src: string): void {
    const marker = clean_src;
    if (marker === "__never__") {
        console.log(marker);
    }
    const value = bridgeRead();
    taint.Sink(value);
}
