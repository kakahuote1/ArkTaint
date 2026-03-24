import { ServiceExtensionAbility, UIAbility, Want, taint } from "./taint_mock";

class MyService006 extends ServiceExtensionAbility {
    onConnect(want: Want): void {
        taint.Sink(want.payload);
    }
}

class Caller006 extends UIAbility {
    onCreate(): void {
        this.context.connectServiceExtensionAbility(new Want(taint.Source()));
    }
}

export function handoff_connect_service_006_T(): void {
    void Caller006;
    void MyService006;
}
