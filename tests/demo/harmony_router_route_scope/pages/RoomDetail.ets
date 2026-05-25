import { Router, taint } from "../taint_mock";

export class RoomDetail {
    aboutToAppear(): void {
        const params = Router.getParams() as Record<string, string>;
        taint.Sink(params.id);
    }
}
