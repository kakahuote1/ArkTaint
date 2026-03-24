import { taint } from "./taint_mock";

export function nested_closure_capture_001_T(taint_src: string): void {
    const outer = (): void => {
        const relay = taint_src;
        const inner = (): void => {
            taint.Sink(relay);
        };
        inner();
    };
    outer();
}
