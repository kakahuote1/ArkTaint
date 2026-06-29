import { taint } from "./taint_mock";

export function sink_type_hint_011_T() {
    const taint_src = taint.SourceReturn("secret");
    const host = new taint.TypeHintHostTarget();
    host.SinkTypeHint(taint_src);
}
