import { taint } from "./taint_mock";

abstract class Pipeline {
  process(v: string): string {
    return this.transform(v);
  }

  abstract transform(v: string): string;
}

class LeakPipeline extends Pipeline {
  transform(v: string): string {
    return v;
  }
}

export function base_template_method_override_009_T(taint_src: string) {
  const pipeline: Pipeline = new LeakPipeline();
  taint.Sink(pipeline.process(taint_src));
}
