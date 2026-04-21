// Algorithm A - Expression Layer: Fallback resolve via Reflect.apply
// Verifies: CG may not resolve Reflect.apply targets, fallbackResolve
// kicks in via reflect dispatch handling to identify the real callee.
import { taint } from "./taint_mock";

function targetSink(data: string): void {
    taint.Sink(data);
}

export function a6_fallback_resolve_001_T(taint_src: string): void {
    Reflect.apply(targetSink, null, [taint_src]);
}
