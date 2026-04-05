import { taint } from "./taint_mock";

export function direct_call_capture_009_T(taint_src: string): void {
    const fp = () => {
        taint.Sink(taint_src);
    };
    fp();
}
