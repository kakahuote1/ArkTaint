// Scenario: third-party payment SDK callback outside the official framework catalog.
// This file is a boundary demo for explicit third-party modeling, not a formal ArkMain entry case.
// The callback should only be covered after explicit module or external binding integration.

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
