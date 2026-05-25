import { Router, taint } from "../taint_mock";

export class LoginCode {
    aboutToAppear(): void {
        const params = Router.getParams() as Record<string, string>;
        taint.Sink(params.phone);
    }
}
