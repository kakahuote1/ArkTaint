import { taint } from "./taint_mock";

export function sink_field_secret_006_F(taint_src: string) {
    const box = { secret: "safe", other: "safe" };
    box.other = taint_src;
    taint.SinkField(box);
}
