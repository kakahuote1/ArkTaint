// Case: Full UIAbility lifecycle with all 7 methods + WindowStage callbacks
// A realistic main ability with proper lifecycle handling
import { UIAbility, Want, WindowStage, taint, Router } from "./taint_mock";

export default class MainAbility extends UIAbility {
    private windowStage: WindowStage | null = null;

    onCreate(want: Want, launchParam: any): void {
        const source = want.parameters?.["deeplink"];
        taint.Sink(source);
        void launchParam;
    }

    onWindowStageCreate(windowStage: WindowStage): void {
        this.windowStage = windowStage;
        windowStage.loadContent("pages/HomePage", (err) => {
            if (err) {
                taint.Sink(err);
            }
        });
    }

    onForeground(): void {
        const params = Router.getParams();
        taint.Sink(params);
    }

    onBackground(): void {
        // save state before going to background
    }

    onNewWant(want: Want): void {
        const payload = want.parameters?.["notification_data"];
        taint.Sink(payload);
    }

    onWindowStageDestroy(): void {
        this.windowStage = null;
    }

    onDestroy(): void {
        // cleanup
    }
}
