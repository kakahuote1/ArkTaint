// Algorithm A - Expression Layer: unmodeled Reflect.apply dispatch is blocked.
// Without an explicit reflection model or analyzer-backed target, this call
// must not create a propagation edge to targetSink.
import { taint } from "./taint_mock";

function targetSink(data: string): void {
    taint.Sink(data);
}

export function a6_reflect_unmodeled_001_F(taint_src: string): void {
    Reflect.apply(targetSink, null, [taint_src]);
}
