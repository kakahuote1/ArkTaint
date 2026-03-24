import webview from "@ohos.web.webview";

function sdk_callback_provenance_004_T(): void {
    let port!: webview.WebMessagePort;

    port.onMessageEvent((result) => {
        console.info(result);
    });
}

export { sdk_callback_provenance_004_T };
