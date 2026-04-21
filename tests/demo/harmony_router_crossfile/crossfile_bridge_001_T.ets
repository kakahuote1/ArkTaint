import { push_from_a } from "./push_page";
import { read_and_sink_from_b } from "./get_page";

export function crossfile_bridge_001_T(taint_src: string): void {
    push_from_a(taint_src);
    read_and_sink_from_b();
}
