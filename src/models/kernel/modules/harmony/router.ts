import { createBuiltinModuleAsset, moduleInvokeSurface } from "../../moduleAssetHelpers";

const pushMethods = [
    { methodName: "pushUrl", routeField: "url" },
    { methodName: "replaceUrl", routeField: "url" },
    { methodName: "pushNamedRoute", routeField: "name" },
    { methodName: "pushPath", routeField: "name" },
    { methodName: "pushPathByName", routeField: "name" },
    { methodName: "replacePath", routeField: "name" },
];
const getMethods = ["getParams"];
const navDestinationRegisterMethods = ["register", "setBuilder", "setDestinationBuilder"];

const harmonyRouterModuleAsset = createBuiltinModuleAsset({
    id: "harmony.router",
    description: "Built-in Harmony router/nav destination bridges.",
    semanticsFamily: "harmony-route-bridge",
    role: "handoff",
    capability: "module.route-bridge",
    surfaces: [
        ...pushMethods.map(method => moduleInvokeSurface(
            `harmony.router.router.${method.methodName}`,
            "router",
            method.methodName,
            1,
            "namespace",
            "@ohos.router",
        )),
        ...getMethods.map(method => moduleInvokeSurface(
            `harmony.router.router.${method}`,
            "router",
            method,
            0,
            "namespace",
            "@ohos.router",
        )),
        ...navDestinationRegisterMethods.map(method => moduleInvokeSurface(
            `harmony.router.NavDestination.${method}`,
            "NavDestination",
            method,
            1,
            "instance",
            "@kit.ArkUI",
        )),
    ],
    payload: {
        pushMethods,
        getMethods,
        navDestinationClassNames: ["NavDestination"],
        navDestinationRegisterMethods,
        frameworkSignatureHints: ["@ohos", "@ohossdk", "@kit", "kit.arkui", "ohos.router", "ohos/router"],
        payloadUnwrapPrefixes: ["param", "params"],
    },
});

export default harmonyRouterModuleAsset;
