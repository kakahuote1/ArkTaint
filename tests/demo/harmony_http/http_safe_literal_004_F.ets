import { Http, taint } from "./taint_mock";

export function http_safe_literal_004_F(): void {
    const h = new Http();
    h.request("/api", "safe");
    taint.Sink("safe");
}
