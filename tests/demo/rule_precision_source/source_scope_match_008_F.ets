import { taint } from "./taint_mock";

export function source_scope_match_008_F() {
    const safe = "safe";
    const out = taint.SourceScope(safe);
    taint.Sink(out);
}
