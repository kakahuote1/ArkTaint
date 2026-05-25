import { taint } from "./taint_mock";

export function sink_object_field_payload_014_T() {
    const taint_src = taint.SourceReturn("phone");
    const payload: any = {};
    payload.name = taint_src;
    payload.phone = taint_src;
    taint.SinkField(payload);
}
