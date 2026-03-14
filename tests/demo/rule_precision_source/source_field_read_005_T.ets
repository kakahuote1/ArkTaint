import { taint } from "./taint_mock";

export function source_field_read_005_T() {
    const box = { secret: "a", other: "b" };
    const value = box.secret;
    taint.Sink(value);
}
