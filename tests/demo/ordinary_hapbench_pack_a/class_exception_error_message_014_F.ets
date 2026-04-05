import { taint } from "./taint_mock";

export function class_exception_error_message_014_F(): void {
  try {
    const safe = "public";
    throw new Error(safe);
  } catch (_err: any) {
    taint.Sink("safe");
  }
}
