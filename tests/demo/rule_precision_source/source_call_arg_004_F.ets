import { taint } from "./taint_mock";

export function source_call_arg_004_F() {
    let userInput = "u";
    taint.SourceArgOther("safe", userInput);
    taint.Sink(userInput);
}
