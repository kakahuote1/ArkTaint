import { Http, taint } from "./taint_mock";

export function http_request_mismatch_005_F(taint_src: string): void {
    const _u = taint_src;
    const h = new Http();
    const resp = h.request("/safe", "safe");
    taint.Sink(resp);
}
