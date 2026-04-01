import { taint } from "./taint_mock";

abstract class Pipeline {
  process(v: string): string {
    return this.transform(v);
  }

  abstract transform(v: string): string;
}

class CleanPipeline extends Pipeline {
  transform(_v: string): string {
    return "_";
  }
}

export function base_template_method_override_010_F(taint_src: string) {
  const pipeline: Pipeline = new CleanPipeline();
  taint.Sink(pipeline.process(taint_src));
}
