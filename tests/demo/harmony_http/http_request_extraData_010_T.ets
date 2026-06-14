import { Http } from "./taint_mock";

export function http_request_extraData_010_T(taint_src: string): void {
    const h = new Http();
    const options = {
        method: "POST",
        extraData: taint_src,
        header: "safe"
    };
    h.request("/api", options);
}
