import { taint } from "./taint_mock";

export function sink_type_hint_011_T(taint_src: string) {
    const host = new taint.TypeHintHostTarget();
    host.SinkTypeHint(taint_src);
}
