import { taint } from "./taint_mock";

export function sink_field_secret_005_T() {
    const taint_src = taint.SourceReturn("secret");
    const secretValue: any = {};
    secretValue.secret = taint_src;
    const box = { secret: secretValue, other: "safe" };
    taint.SinkField(box);
}
