export class CloudMessaging {
    onMessageReceived(_callback: (message: any) => void): void {}
    connect(_serverUrl: string): void {}
}

export class PaymentClient {
    processPayment(_order: any, _onResult: (result: any) => void): void {}
    getOrderStatus(_orderId: string): string { return ""; }
}

export namespace taint {
    export function Source(): any { return {}; }
    export function Sink(value: any): void { void value; }
}
