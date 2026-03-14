import { taint } from "./taint_mock";

export function sink_type_hint_012_F(taint_src: string) {
    const host = new taint.TypeHintHostOther();
    host.SinkTypeHint(taint_src);
}
