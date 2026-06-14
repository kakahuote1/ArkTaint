import { taint } from "./taint_mock";

export function caller_callee_scope_allowed_007_T(taint_src: string) {
    const http = new taint.HttpRequestHost();
    http.request(taint_src);
}

export function caller_callee_scope_rejected_008_F(taint_src: string) {
    const http = new taint.HttpRequestHost();
    http.request(taint_src);
}
