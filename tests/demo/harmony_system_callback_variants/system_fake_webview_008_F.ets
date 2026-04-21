import { FakeWebView, taint } from "./taint_mock";

class EntryPage008 {
    build(): void {
        const webView = new FakeWebView();
        webView.onMessage((payload) => {
            taint.Sink(payload.token);
        });
    }
}

export function system_fake_webview_008_F(): void {
    void EntryPage008;
}
