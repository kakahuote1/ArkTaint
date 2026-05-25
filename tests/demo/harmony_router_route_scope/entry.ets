import { Router } from "./taint_mock";
import { LoginCode } from "./pages/LoginCode";
import { RoomDetail } from "./pages/RoomDetail";

export function router_route_scope_login_T(taint_src: string): void {
    Router.pushUrl({
        url: "pages/LoginCode",
        params: { phone: taint_src },
    });
    new LoginCode().aboutToAppear();
}

export function router_route_scope_mismatch_F(taint_src: string): void {
    Router.pushUrl({
        url: "pages/LoginCode",
        params: { phone: taint_src },
    });
    new RoomDetail().aboutToAppear();
}
