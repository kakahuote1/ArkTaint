import { Router, taint } from "./taint_mock";

export function read_and_sink_from_b(): void {
    const p = Router.getParams();
    taint.Sink(p);
}
