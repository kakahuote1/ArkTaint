import { Web, taint } from "./taint_mock";

class JsBridgeTarget {
    callbackhtml(html: string): void {
        taint.Sink(html);
    }

    notExposed(secret: string): void {
        taint.Sink(secret);
    }
}

class WebJsProxyPage {
    private target: JsBridgeTarget = new JsBridgeTarget();

    build(): void {
        const web = new Web();
        web.javaScriptProxy({
            object: this.target,
            name: "callBackToApp",
            methodList: ["callbackhtml"],
            controller: {}
        });
    }
}

export function web_js_proxy_001_T(): void {
    const page = new WebJsProxyPage();
    page.build();
}
