import { Http, taint } from "./taint_mock";

export function http_callback_safe_007_F(taint_src: string): void {
    const _u = taint_src;
    const h = new Http();
    h.requestAsync("/safe", (_resp: any): void => {
        taint.Sink("safe");
    });
}
