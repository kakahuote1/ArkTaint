import webview from "@ohos.web.webview";

class WebViewLike {
  private controller: webview.WebviewController = new webview.WebviewController();

  getController(): webview.WebviewController {
    return this.controller;
  }
}

export function webview_bridge_scope_004_T(input: string): void {
  let taint_src = input;
  let webView = new WebViewLike();
  const script = `javascript:window.bridge(${taint_src})`;
  webView.getController().runJavaScript(script);
}
