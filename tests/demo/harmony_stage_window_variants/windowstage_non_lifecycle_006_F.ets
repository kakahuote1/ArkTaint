import { taint } from "./taint_mock";

class EntryAbility006 {
    refreshWindow(): void {
        taint.Sink("clean");
    }
}

export function windowstage_non_lifecycle_006_F(): void {
    void EntryAbility006;
}
