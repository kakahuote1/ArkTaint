import { WindowStage, taint } from "./taint_mock";

class EntryAbility {
    onWindowStageCreate(stage: WindowStage): void {
        stage.loadContent("MainPage", (err, _data) => {
            taint.Sink(err);
        });
    }
}

export function windowstage_loadcontent_007_F(): void {
    void EntryAbility;
}
