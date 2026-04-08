// 场景：第三方推送 SDK（CloudMessaging），不在任何 framework catalog 中。
// Layer 1 (sdk_provenance): 失败 — CloudMessaging 不是 SDK 声明
// Layer 2 (owner_qualified_fallback): 失败 — CloudMessaging 不在已知 owner 集合
// Layer 3 (empty_owner_fallback): 失败 — owner 非空
// Layer 4 (structural_callable_fallback): 应成功 — onMessageReceived 的第一个参数是 callable
//
// 预期：ArkMain 通过 Layer 4 发现 callback，将其注入 synthetic root。

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
