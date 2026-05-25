import { taint } from "./taint_mock";

class LocalAxios {
    get(_url: string): void {
        // local method with same short name is not a framework sink.
    }
}

export function axios_import_scope_002_F(userInput: string): void {
    const localAxios = new LocalAxios();
    localAxios.get("https://example.com/search?q=" + userInput);
    taint.Sink("safe");
}
