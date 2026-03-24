import { WebView, taint } from "./taint_mock";
import { registerWebMessageExternal } from "./helpers";

class EntryPage005 {
    build(): void {
        const webView = new WebView();
        registerWebMessageExternal(webView, (payload) => {
            taint.Sink(payload.token);
        });
    }
}

export function system_webview_crossfile_005_T(): void {
    void EntryPage005;
}
