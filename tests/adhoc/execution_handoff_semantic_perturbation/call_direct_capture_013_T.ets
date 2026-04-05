import { taint } from "./taint_mock";

export function call_direct_capture_013_T(taint_src: string): void {
    const fp = () => {
        taint.Sink(taint_src);
    };
    fp();
}
