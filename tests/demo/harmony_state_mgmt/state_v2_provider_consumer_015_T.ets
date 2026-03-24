import { Consumer, Provider, taint } from "./taint_mock";

class DescendantV2Consumer015 {
    @Consumer("token")
    token: string = "";

    build(): void {
        taint.Sink(this.token);
    }
}

class AncestorV2Provider015 {
    @Provider("token")
    token: string = "";

    build(): void {
        const d = new DescendantV2Consumer015();
        d.build();
    }
}

export function state_v2_provider_consumer_015_T(taint_src: string): void {
    const a = new AncestorV2Provider015();
    a.token = taint_src;
    a.build();
}
