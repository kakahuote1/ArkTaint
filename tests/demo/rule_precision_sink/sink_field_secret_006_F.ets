import { taint } from "./taint_mock";

export function sink_field_secret_006_F() {
    const taint_src = taint.SourceReturn("secret");
    const otherValue: any = {};
    otherValue.secret = taint_src;
    const box = { secret: "safe", other: otherValue };
    taint.SinkField(box);
}
