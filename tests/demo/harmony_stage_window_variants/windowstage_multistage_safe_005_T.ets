import { WindowStage, taint } from "./taint_mock";

class EntryAbility005 {
    private token: string = "";

    onWindowStageCreate(_stage: WindowStage): void {
        this.token = "clean";
    }

    onWindowStageDestroy(): void {
        taint.Sink(this.token);
    }
}

export function windowstage_multistage_safe_005_T(): void {
    void EntryAbility005;
}
