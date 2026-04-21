import { taint } from "./taint_mock";

export function source_call_arg_003_T() {
    let userInput = "u";
    taint.SourceArg("safe", userInput);
    taint.Sink(userInput);
}
