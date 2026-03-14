import { Http, taint } from "./taint_mock";

export function http_response_source_002_T(taint_src: string): void {
    const _u = taint_src;
    const h = new Http();
    const resp = h.request("/profile", "safe");
    taint.Sink(resp);
}
