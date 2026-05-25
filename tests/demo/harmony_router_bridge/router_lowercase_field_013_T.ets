import { router, taint } from "./taint_mock";

class RouterLowercaseTarget013 {
    private phone: string = "";

    aboutToAppear(): void {
        const params = router.getParams() as Record<string, string>;
        this.phone = params.phone;
    }

    submit(): void {
        taint.Sink(this.phone);
    }
}

export function router_lowercase_field_013_T(taint_src: string): void {
    router.pushUrl({ url: "LoginCode", params: { phone: taint_src } });
    const page = new RouterLowercaseTarget013();
    page.aboutToAppear();
    page.submit();
}
