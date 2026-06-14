class ProjectController {
  runJavaScript(script: string): void {
    void script;
  }
}

class ProjectBridgeHelper {
  private controller: ProjectController;

  constructor(controller: ProjectController) {
    this.controller = controller;
  }

  dispatch(message: string): void {
    const script = `javascript:window.bridge(${message})`;
    this.controller.runJavaScript(script);
  }
}

export function webview_bridge_scope_002_F(input: string): void {
  let taint_src = input;
  let controller = new ProjectController();
  let helper = new ProjectBridgeHelper(controller);
  helper.dispatch(taint_src);
}
