import { Router, taint } from "./taint_mock";

class RouterFieldTarget012 {
    private phone: string = "";

    aboutToAppear(): void {
        const params = Router.getParams() as Record<string, string>;
        this.phone = params.phone;
    }

    submit(): void {
        taint.Sink(this.phone);
    }
}

export function router_params_field_012_T(taint_src: string): void {
    Router.pushUrl({ url: "LoginCode", params: { phone: taint_src } });
    const page = new RouterFieldTarget012();
    page.aboutToAppear();
    page.submit();
}
