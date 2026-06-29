import { taint } from "./taint_mock";

export function sink_type_hint_012_F() {
    const taint_src = taint.SourceReturn("secret");
    const host = new taint.TypeHintHostOther();
    host.SinkTypeHint(taint_src);
}
