import { CommonEventManager, taint } from "./taint_mock";

export function sink_commonevent_publishAsUser_005_T(userInput: string): void {
    const manager = new CommonEventManager();
    const payload = {
        data: taint.Source() + userInput,
    };
    manager.publishAsUser("demo.event", 100, payload);
}
