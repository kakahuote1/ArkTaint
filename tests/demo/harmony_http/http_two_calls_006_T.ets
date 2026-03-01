import { Http, taint } from "./taint_mock";

export function http_two_calls_006_T(taint_src: string): void {
    const h = new Http();
    h.request("/safe", "ok");
    const out = h.request("/taint", taint_src);
    taint.Sink(out);
}
