// Case: WebView with bidirectional JS-native bridge
// Real pattern: native code calls JS, JS calls back to native via onMessage
import { WebView, Web, taint } from "./taint_mock";

class WebDashboard {
    private webController: WebView;
    private currentUrl: string = "";

    constructor() {
        this.webController = new WebView();
    }

    build(): void {
        const web = new Web();

        web.onPageBegin((event: { url: string }) => {
            this.currentUrl = event.url;
            taint.Sink(this.currentUrl);
        });

        web.onPageEnd((event: { url: string }) => {
            // inject native bridge after page load
            this.webController.runJavaScript(
                "window.nativeBridge.init('" + event.url + "')"
            );
        });

        web.onErrorReceive((event: any) => {
            taint.Sink(event?.error);
        });

        // Receive messages from JavaScript
        this.webController.onMessage((msg: string) => {
            const parsed = this.parseJsBridgeMessage(msg);
            taint.Sink(parsed);
            this.handleJsCommand(parsed);
        });
    }

    aboutToAppear(): void {
        this.currentUrl = "https://dashboard.smarthome.local";
    }

    private parseJsBridgeMessage(raw: string): any {
        taint.Sink(raw);
        return { command: raw };
    }

    private handleJsCommand(cmd: any): void {
        taint.Sink(cmd);
        this.webController.runJavaScript("ack('" + cmd?.command + "')");
    }
}

export { WebDashboard };
