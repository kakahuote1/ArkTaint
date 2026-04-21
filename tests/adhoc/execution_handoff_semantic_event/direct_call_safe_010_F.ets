import { taint } from "./taint_mock";

export function direct_call_safe_010_F(taint_src: string): void {
    const fp = () => {
        void taint_src;
        taint.Sink("safe");
    };
    fp();
}
