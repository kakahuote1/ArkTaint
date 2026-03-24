import { FakeWindowStage, taint } from "./taint_mock";

class EntryAbility007 {
    onWindowStageCreate(stage: FakeWindowStage): void {
        stage.loadContent("MainPage", (_err, data) => {
            taint.Sink(data.token);
        });
    }
}

export function system_fake_window_007_F(): void {
    void EntryAbility007;
}
