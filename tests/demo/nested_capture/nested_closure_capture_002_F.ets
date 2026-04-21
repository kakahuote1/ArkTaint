import { taint } from "./taint_mock";

export function nested_closure_capture_002_F(taint_src: string): void {
    const _shadow = taint_src;
    const outer = (): void => {
        const clean = "safe";
        const inner = (): void => {
            taint.Sink(clean);
        };
        inner();
    };
    outer();
}
