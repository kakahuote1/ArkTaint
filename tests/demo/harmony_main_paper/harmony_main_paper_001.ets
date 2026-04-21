namespace taint {
    export function Source(): string {
        return "static_secret";
    }

    export function Sink(_value: any): void {}
}

class UIAbility {}

class WindowStage {}

class UIButton {
    onClick(_cb: (event: string) => void): void {}
}

class StaticSeedHolder {
    static SHARED: string = taint.Source();
}

function cbOnClick(event: string): void {
    taint.Sink(StaticSeedHolder.SHARED);
    taint.Sink(event);
}

class EntryAbility extends UIAbility {
    onCreate(): void {}

    onWindowStageCreate(_stage: WindowStage): void {}

    onForeground(): void {}

    onBackground(): void {}

    onWindowStageDestroy(): void {}

    onDestroy(): void {}
}

@Entry
@Component
struct DemoPage {
    aboutToAppear(): void {}

    onPageShow(): void {}

    onPageHide(): void {}

    build(): void {
        const button = new UIButton();
        button.onClick(cbOnClick);
    }
}

export function harmony_main_paper_001(): void {
    const ability = new EntryAbility();
    const stage = new WindowStage();
    const page = new DemoPage();
    ability.onCreate();
    ability.onWindowStageCreate(stage);
    ability.onForeground();
    page.aboutToAppear();
    page.onPageShow();
    page.build();
    page.onPageHide();
    ability.onBackground();
    ability.onWindowStageDestroy();
    ability.onDestroy();
}
