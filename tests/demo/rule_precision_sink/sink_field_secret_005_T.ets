import { taint } from "./taint_mock";

export function sink_field_secret_005_T(taint_src: string) {
    const box = { secret: "safe", other: "safe" };
    box.secret = taint_src;
    taint.SinkField(box);
}
