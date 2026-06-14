import { Http, taint } from "./taint_mock";

export function http_request_callback_safe_009_F(): void {
    const h = new Http();
    h.request("/profile", { method: "GET" }, (_err: any, _data: any): void => {
        taint.Sink("safe");
    });
}
