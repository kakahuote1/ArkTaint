import { taint } from "./taint_mock";

export function source_call_return_001_T() {
    const safe = "safe";
    const out = taint.SourceReturn(safe);
    taint.Sink(out);
}
