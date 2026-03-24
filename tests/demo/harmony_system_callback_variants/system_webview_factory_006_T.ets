import { WebView, createWebMessageHandler } from "./taint_mock";

class EntryPage006 {
    build(): void {
        const webView = new WebView();
        webView.onMessage(createWebMessageHandler());
    }
}

export function system_webview_factory_006_T(): void {
    void EntryPage006;
}
