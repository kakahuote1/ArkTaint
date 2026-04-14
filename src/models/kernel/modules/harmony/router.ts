import type { ModuleSpec } from "../../../../core/kernel/contracts/ModuleSpec";

const harmonyRouterModuleSpec: ModuleSpec = {
    id: "harmony.router",
    description: "Built-in Harmony router/nav destination bridges.",
    semantics: [
        {
            id: "route_bridge",
            kind: "route_bridge",
            pushMethods: [
                { methodName: "pushUrl", routeField: "url" },
                { methodName: "replaceUrl", routeField: "url" },
                { methodName: "pushNamedRoute", routeField: "name" },
                { methodName: "pushPath", routeField: "name" },
                { methodName: "pushPathByName", routeField: "name" },
                { methodName: "replacePath", routeField: "name" },
            ],
            getMethods: ["getParams"],
            navDestinationClassNames: ["NavDestination"],
            navDestinationRegisterMethods: ["register", "setBuilder", "setDestinationBuilder"],
            frameworkSignatureHints: ["@ohos", "@ohossdk", "ohos.router", "ohos/router"],
            payloadUnwrapPrefixes: ["param", "params"],
        },
    ],
};

export default harmonyRouterModuleSpec;

