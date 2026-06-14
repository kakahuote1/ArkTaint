import webview from "@ohos.web.webview";

class WebBridgeHelper {
  private controller: webview.WebviewController;

  constructor(controller: webview.WebviewController) {
    this.controller = controller;
  }

  dispatch(message: string): void {
    const script = `javascript:window.bridge(${message})`;
    this.controller.runJavaScript(script);
  }
}

export function webview_bridge_scope_001_T(input: string): void {
  let taint_src = input;
  let controller: webview.WebviewController = new webview.WebviewController();
  let helper = new WebBridgeHelper(controller);
  helper.dispatch(taint_src);
}
