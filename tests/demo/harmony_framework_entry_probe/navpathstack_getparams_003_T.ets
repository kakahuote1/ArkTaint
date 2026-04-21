import { NavPathStack, taint } from "./taint_mock";

class NavPage {
    aboutToAppear(): void {
        const params = new NavPathStack().getParams();
        taint.Sink(params["token"]);
    }
}

export function navpathstack_getparams_003_T(): void {
    const page = new NavPage();
    page.aboutToAppear();
}
