import webview from "@ohos.web.webview";

export function webview_controller_sdk_field_scope_003_T(input: string): void {
    let taint_src = input;
    let controller: webview.WebviewController = new webview.WebviewController();
    controller.runJavaScript(taint_src);
}
