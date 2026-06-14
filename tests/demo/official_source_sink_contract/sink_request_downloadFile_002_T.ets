import { request, taint } from "./taint_mock";

export function sink_request_downloadFile_002_T(userInput: string): void {
    const config = {
        url: taint.Source() + userInput,
        header: { Authorization: userInput },
    };
    request.downloadFile({}, config);
}
