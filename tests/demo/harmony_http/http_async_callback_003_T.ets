import { Http, taint } from "./taint_mock";

export function http_async_callback_003_T(taint_src: string): void {
    const h = new Http();
    h.requestAsync("/u", (resp: any): void => {
        taint.Sink(resp);
    });
    h.request("/post", taint_src);
}
