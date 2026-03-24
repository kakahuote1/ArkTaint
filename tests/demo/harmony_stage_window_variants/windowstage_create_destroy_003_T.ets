import { WindowStage, taint } from "./taint_mock";

class EntryAbility003 {
    private token: string = "";

    onWindowStageCreate(_stage: WindowStage): void {
        this.token = taint.Source();
    }

    onWindowStageDestroy(): void {
        taint.Sink(this.token);
    }
}

export function windowstage_create_destroy_003_T(): void {
    void EntryAbility003;
}
