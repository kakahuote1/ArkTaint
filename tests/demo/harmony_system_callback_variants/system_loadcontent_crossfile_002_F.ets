import { WindowStage, taint } from "./taint_mock";
import { registerLoadContentExternal } from "./helpers";

class EntryAbility002 {
    onWindowStageCreate(stage: WindowStage): void {
        registerLoadContentExternal(stage, (_err, data) => {
            taint.Sink(data.token);
        });
    }
}

export function system_loadcontent_crossfile_002_F(): void {
    void EntryAbility002;
}
