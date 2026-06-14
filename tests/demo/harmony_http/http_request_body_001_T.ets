import { Http, taint } from "./taint_mock";

export function http_request_body_001_T(taint_src: string): void {
    const h = new Http();
    h.request("/api", { extraData: taint_src });
    taint.Sink(h.request("/api2", { extraData: taint_src }));
}
