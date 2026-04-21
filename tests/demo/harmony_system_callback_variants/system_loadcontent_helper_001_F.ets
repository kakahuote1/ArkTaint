import { WindowStage, registerLoadContent, taint } from "./taint_mock";

class EntryAbility001 {
    onWindowStageCreate(stage: WindowStage): void {
        registerLoadContent(stage, (_err, data) => {
            taint.Sink(data.token);
        });
    }
}

export function system_loadcontent_helper_001_F(): void {
    void EntryAbility001;
}
