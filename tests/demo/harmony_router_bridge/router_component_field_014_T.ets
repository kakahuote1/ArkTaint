import { router, taint } from "./taint_mock";

class RouterSourcePage014 {
    private phone: string = "";

    onChange(value: string): void {
        this.phone = value;
    }

    go(): void {
        router.pushUrl({ url: "LoginCode", params: { phone: this.phone } });
    }
}

class RouterTargetPage014 {
    private phone: string = "";

    aboutToAppear(): void {
        const params = router.getParams() as Record<string, string>;
        this.phone = params.phone;
    }

    submit(): void {
        taint.Sink(this.phone);
    }
}

export function router_component_field_014_T(taint_src: string): void {
    const source = new RouterSourcePage014();
    source.onChange(taint_src);
    source.go();

    const target = new RouterTargetPage014();
    target.aboutToAppear();
    target.submit();
}
