import { taint } from "./taint_mock";

export function source_field_read_006_F() {
    const box = { secret: "a", other: "b" };
    const value = box.other;
    taint.Sink(value);
}
