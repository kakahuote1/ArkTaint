// Case: NavPathStack navigation with NavDestination callback registration
// Real pattern: Navigation container + NavDestination for deep page routing
import { NavPathStack, NavDestination, Router, taint } from "./taint_mock";

class NavigationContainer {
    private navStack: NavPathStack;
    private navDestination: NavDestination;

    constructor() {
        this.navStack = new NavPathStack();
        this.navDestination = new NavDestination();
    }

    aboutToAppear(): void {
        // register named destinations
        this.navDestination.register("deviceDetail", () => {
            const param = this.navStack.getParamByName("deviceDetail");
            taint.Sink(param);
        });

        this.navDestination.register("roomSettings", () => {
            const param = this.navStack.getParamByName("roomSettings");
            taint.Sink(param);
        });
    }

    build(): void {
        // navigation actions within build
        this.navStack.pushPath({
            name: "deviceDetail",
            param: { deviceId: taint.Source() },
        });

        this.navStack.pushPathByName("roomSettings", { roomId: "living_room" });

        // traditional router alongside NavPathStack
        Router.pushUrl({
            url: "pages/AdvancedSettings",
            params: { section: taint.Source() },
        });
    }

    onPageShow(): void {
        const routerParams = Router.getParams();
        taint.Sink(routerParams);
    }
}

export { NavigationContainer };
