import { WindowStage, createLoadContentHandler } from "./taint_mock";

class EntryAbility003 {
    onWindowStageCreate(stage: WindowStage): void {
        stage.loadContent("MainPage", createLoadContentHandler());
    }
}

export function system_loadcontent_factory_003_F(): void {
    void EntryAbility003;
}
