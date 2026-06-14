import { webview } from "@kit.ArkWeb";

class KitWebBridgeHelper {
  private controller: webview.WebviewController;

  constructor(controller: webview.WebviewController) {
    this.controller = controller;
  }

  dispatch(message: string): void {
    const script = `javascript:window.bridge(${JSON.stringify(message)})`;
    this.controller.runJavaScript(script);
  }
}

export function webview_bridge_scope_003_T(input: string): void {
  let taint_src = input;
  let controller: webview.WebviewController = new webview.WebviewController();
  let helper = new KitWebBridgeHelper(controller);
  helper.dispatch(taint_src);
}
