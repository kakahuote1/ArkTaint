import { cacheDownload, taint } from "./taint_mock";

export function sink_request_cacheDownload_003_T(userInput: string): void {
    const config = {
        url: taint.Source() + userInput,
        filePath: "/tmp/file",
    };
    cacheDownload.download({}, config);
}
