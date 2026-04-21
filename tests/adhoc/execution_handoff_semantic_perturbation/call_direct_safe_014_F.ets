import { taint } from "./taint_mock";

export function call_direct_safe_014_F(taint_src: string): void {
    const fp = () => {
        void taint_src;
        taint.Sink("safe");
    };
    fp();
}
