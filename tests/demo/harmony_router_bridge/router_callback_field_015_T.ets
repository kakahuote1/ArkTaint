import { Button, router, State, taint } from "./taint_mock";

class RouterCallbackSource015 {
    @State
    private phone: string = "";

    onChange(value: string): void {
        this.phone = value;
    }

    build(): void {
        const button = new Button();
        button.onClick(() => {
            router.pushUrl({ url: "LoginCode", params: { phone: this.phone } });
        });
    }
}

class RouterCallbackTarget015 {
    private phone: string = "";

    aboutToAppear(): void {
        const params = router.getParams() as Record<string, string>;
        this.phone = params.phone;
    }

    submit(): void {
        taint.Sink(this.phone);
    }
}

export function router_callback_field_015_T(taint_src: string): void {
    const source = new RouterCallbackSource015();
    source.onChange(taint_src);
    source.build();

    const target = new RouterCallbackTarget015();
    target.aboutToAppear();
    target.submit();
}
