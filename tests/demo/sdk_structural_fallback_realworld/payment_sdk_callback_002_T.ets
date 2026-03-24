// 场景：第三方支付 SDK（PaymentClient），不在任何 framework catalog 中。
// Layer 1 (sdk_provenance): 失败 — PaymentClient 不是 SDK 声明
// Layer 2 (owner_qualified_fallback): 失败 — PaymentClient 不在已知 owner 集合
// Layer 3 (empty_owner_fallback): 失败 — owner 非空
// Layer 4 (structural_callable_fallback): 应成功 — processPayment 的第二个参数是 callable
//
// 注意：第一个参数 order 不是 callable，只有第二个参数 onResult 是 callable。
// Layer 4 应该精确识别 callbackArgIndex = [1]，不误认 order 为 callback。
//
// 预期：ArkMain 通过 Layer 4 发现 onResult callback，将其注入 synthetic root。

import { PaymentClient, taint } from "./taint_mock";

@Entry
@Component
class PaymentPage {
    private client: PaymentClient = new PaymentClient();

    build(): void {
        const order = { amount: 100, item: "test" };
        this.client.processPayment(order, (result) => {
            const transactionId = result.txId;
            taint.Sink(transactionId);
        });
    }
}

export function payment_sdk_callback_002_T(): void {
    void PaymentPage;
}
