import { WindowStage, taint } from "./taint_mock";

class EntryAbility {
    onWindowStageCreate(stage: WindowStage): void {
        stage.loadContent("MainPage", (_err, data) => {
            taint.Sink(data.token);
        });
    }
}

export function windowstage_loadcontent_006_F(): void {
    void EntryAbility;
}
