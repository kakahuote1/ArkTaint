import { taint } from "./taint_mock";

export function class_exception_error_message_013_T(): void {
  try {
    const taint_src = "secret";
    throw new Error(taint_src);
  } catch (err: any) {
    taint.Sink(err.message);
  }
}

