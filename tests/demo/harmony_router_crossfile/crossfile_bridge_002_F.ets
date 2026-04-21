import { push_safe_from_a } from "./push_page";
import { read_and_sink_from_b } from "./get_page";

export function crossfile_bridge_002_F(taint_src: string): void {
    push_safe_from_a();
    read_and_sink_from_b();
}
