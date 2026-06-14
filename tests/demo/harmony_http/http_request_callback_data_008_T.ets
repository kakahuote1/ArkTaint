import { Http, taint } from "./taint_mock";

export function http_request_callback_data_008_T(): void {
    const h = new Http();
    h.request("/profile", { method: "GET" }, (_err: any, data: any): void => {
        taint.Sink(data);
    });
}
