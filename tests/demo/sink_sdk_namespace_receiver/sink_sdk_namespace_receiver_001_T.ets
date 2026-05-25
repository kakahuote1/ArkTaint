import webview from '@ohos.web.webview';

function sink_sdk_namespace_receiver_001_T(input: string): void {
  let taint_src = input;
  let controller: webview.WebviewController = new webview.WebviewController();
  controller.runJavaScript(taint_src);
}
