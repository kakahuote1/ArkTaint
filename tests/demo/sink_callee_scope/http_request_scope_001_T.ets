import { taint } from "./taint_mock";

export function http_request_scope_001_T(taint_src: string) {
    const http = new taint.HttpRequestHost();
    http.request(taint_src);
}
