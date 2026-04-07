// Scenario: third-party push SDK callback outside the official framework catalog.
// This file is a boundary demo for explicit third-party modeling, not a formal ArkMain entry case.
// The callback should only be covered after explicit module or external binding integration.

import { CloudMessaging, taint } from "./taint_mock";

@Entry
@Component
class PushListenerPage {
    private messaging: CloudMessaging = new CloudMessaging();

    build(): void {
        this.messaging.onMessageReceived((message) => {
            const payload = message.data;
            taint.Sink(payload);
        });
    }
}

export function push_sdk_callback_001_T(): void {
    void PushListenerPage;
}
