import { WebView, registerWebMessage, taint } from "./taint_mock";

class EntryPage004 {
    build(): void {
        const webView = new WebView();
        registerWebMessage(webView, (payload) => {
            taint.Sink(payload.token);
        });
    }
}

export function system_webview_helper_004_T(): void {
    void EntryPage004;
}
