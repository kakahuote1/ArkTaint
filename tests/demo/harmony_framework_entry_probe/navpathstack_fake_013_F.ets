import { taint } from "./taint_mock";

class NavPathStackFake {
    getParams(): Record<string, any> {
        return { token: "fake-token" };
    }
}

class NavPage {
    aboutToAppear(): void {
        const params = new NavPathStackFake().getParams();
        taint.Sink(params["token"]);
    }
}

export function navpathstack_fake_013_F(): void {
    void NavPage;
}
