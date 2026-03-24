import { WebView, taint } from "./taint_mock";

class EntryPage {
    build(): void {
        const webView = new WebView();
        webView.onMessage((payload) => {
            taint.Sink(payload);
        });
    }
}

export function webview_onmessage_008_T(): void {
    void EntryPage;
}
