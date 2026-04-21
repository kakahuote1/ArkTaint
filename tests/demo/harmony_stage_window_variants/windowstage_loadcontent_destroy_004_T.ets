import { WindowStage, taint } from "./taint_mock";

class EntryAbility004 {
    private token: string = "";

    onWindowStageCreate(stage: WindowStage): void {
        stage.loadContent("MainPage", (_err, data) => {
            this.token = data.token;
        });
    }

    onWindowStageDestroy(): void {
        taint.Sink(this.token);
    }
}

export function windowstage_loadcontent_destroy_004_T(): void {
    void EntryAbility004;
}
