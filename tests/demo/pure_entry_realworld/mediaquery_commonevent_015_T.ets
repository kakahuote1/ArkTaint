// Case: MediaQuery breakpoint listener + CommonEventSubscriber
// Real pattern: responsive layout + system broadcast events
import { matchMediaSync, CommonEventSubscriber, taint } from "./taint_mock";

class ResponsiveDashboard {
    private isWideScreen: boolean = false;
    private currentLayout: string = "compact";

    aboutToAppear(): void {
        // MediaQuery listener for screen breakpoints
        const portraitListener = matchMediaSync("(orientation: portrait)");
        portraitListener.on("change", (result: any) => {
            this.isWideScreen = !result?.matches;
            taint.Sink(result?.matches);
            this.recalculateLayout();
        });

        const widthListener = matchMediaSync("(width > 600vp)");
        widthListener.on("change", (result: any) => {
            if (result?.matches) {
                this.currentLayout = "wide";
            } else {
                this.currentLayout = "compact";
            }
            taint.Sink(this.currentLayout);
        });

        // System broadcast subscriber
        CommonEventSubscriber.subscribe(
            { events: ["usual.event.BATTERY_LOW", "usual.event.SCREEN_ON"] },
            (err: any, data: any) => {
                if (err) {
                    taint.Sink(err);
                    return;
                }
                taint.Sink(data);
                this.handleSystemEvent(data?.event, data?.parameters);
            }
        );
    }

    build(): void {
        // layout depends on current breakpoint
        if (this.currentLayout === "wide") {
            this.buildWideLayout();
        } else {
            this.buildCompactLayout();
        }
    }

    private recalculateLayout(): void {}
    private buildWideLayout(): void {}
    private buildCompactLayout(): void {}

    private handleSystemEvent(event: string, params: any): void {
        taint.Sink(event);
        taint.Sink(params);
    }
}

export { ResponsiveDashboard };
