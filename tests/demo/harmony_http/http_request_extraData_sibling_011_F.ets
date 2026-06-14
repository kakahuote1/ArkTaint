import { Http } from "./taint_mock";

export function http_request_extraData_sibling_011_F(taint_src: string): void {
    const h = new Http();
    const options = {
        method: "POST",
        extraData: "safe",
        header: taint_src
    };
    h.request("/api", options);
}
