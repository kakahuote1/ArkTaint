class ProjectRunner {
  runJavaScript(script: string): void {
    void script;
  }
}

function sink_sdk_namespace_receiver_002_F(input: string): void {
  let taint_src = input;
  let runner = new ProjectRunner();
  runner.runJavaScript(taint_src);
}
