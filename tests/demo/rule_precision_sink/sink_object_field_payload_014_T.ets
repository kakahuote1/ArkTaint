import { taint } from "./taint_mock";

export function sink_object_field_payload_014_T() {
    const taint_src = taint.SourceReturn("phone");
    const phoneValue: any = {};
    phoneValue.phone = taint_src;
    const payload = { name: "safe", phone: phoneValue };
    taint.SinkField(payload);
}
