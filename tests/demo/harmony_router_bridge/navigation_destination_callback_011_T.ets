import { NavDestination, NavPathStack, taint } from "./taint_mock";

function navDetailBuilder011(param: any): void {
    taint.Sink(param);
}

export function navigation_destination_callback_011_T(taint_src: string): void {
    NavDestination.register("SafeDetail", navDetailBuilder011);

    NavPathStack.pushPath({ name: "OtherPage", param: taint_src });
    NavDestination.trigger("SafeDetail");
}
