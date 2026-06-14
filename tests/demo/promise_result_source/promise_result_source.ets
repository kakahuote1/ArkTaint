import { taint } from './taint_mock';

class PromiseApi {
  fetch(): Promise<string> {
    return Promise.resolve("remote");
  }
}

export function promise_result_source_then_001_T(): void {
  const api = new PromiseApi();
  api.fetch().then(data => {
    taint.Sink(data);
  });
}

export function promise_result_source_safe_002_F(): void {
  const api = new PromiseApi();
  api.fetch().then(_data => {
    taint.Sink("safe");
  });
}

export function promise_result_source_unrelated_entry_003_F(): void {
  taint.Sink("safe");
}
