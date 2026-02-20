import { taint } from "./taint_mock";

export function source_call_return_002_F() {
    const safe = "safe";
    const out = taint.SourceOther(safe);
    taint.Sink(out);
}
