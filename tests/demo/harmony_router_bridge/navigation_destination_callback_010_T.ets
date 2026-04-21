import { NavDestination, NavPathStack, taint } from "./taint_mock";

function navDetailBuilder010(param: any): void {
    taint.Sink(param);
}

export function navigation_destination_callback_010_T(taint_src: string): void {
    NavDestination.register("Detail", navDetailBuilder010);

    NavPathStack.pushPath({ name: "Detail", param: taint_src });
    NavDestination.trigger("Detail");
}
