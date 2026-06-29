import { createBuiltinModuleAsset } from "../../moduleAssetHelpers";
import { officialInvokeSurfaceFromId } from "../../moduleAssetHelpers";

const pushCanonicalApiIds = [
    "api:official:openharmony:module=%40ohos.router:file=api%2F%40ohos.router.d.ets:export=default%3Arouter:decl=namespace%3Arouter:member=function%3Apush:invoke=call:params=0%3ARouterOptions:ret=void",
];

const pushUrlCanonicalApiIds = [
    "api:official:openharmony:module=%40ohos.router:file=api%2F%40ohos.router.d.ets:export=default%3Arouter:decl=namespace%3Arouter:member=function%3ApushUrl:invoke=call:params=0%3ARouterOptions:ret=Promise%3Cvoid%3E",
    "api:official:openharmony:module=%40ohos.router:file=api%2F%40ohos.router.d.ets:export=default%3Arouter:decl=namespace%3Arouter:member=function%3ApushUrl:invoke=call:params=0%3ARouterOptions%2C1%3AAsyncCallback%3Cvoid%3E:ret=void",
    "api:official:openharmony:module=%40ohos.router:file=api%2F%40ohos.router.d.ets:export=default%3Arouter:decl=namespace%3Arouter:member=function%3ApushUrl:invoke=call:params=0%3ARouterOptions%2C1%3ARouterMode:ret=Promise%3Cvoid%3E",
    "api:official:openharmony:module=%40ohos.router:file=api%2F%40ohos.router.d.ets:export=default%3Arouter:decl=namespace%3Arouter:member=function%3ApushUrl:invoke=call:params=0%3ARouterOptions%2C1%3ARouterMode%2C2%3AAsyncCallback%3Cvoid%3E:ret=void",
];

const replaceCanonicalApiIds = [
    "api:official:openharmony:module=%40ohos.router:file=api%2F%40ohos.router.d.ets:export=default%3Arouter:decl=namespace%3Arouter:member=function%3Areplace:invoke=call:params=0%3ARouterOptions:ret=void",
];

const replaceUrlCanonicalApiIds = [
    "api:official:openharmony:module=%40ohos.router:file=api%2F%40ohos.router.d.ets:export=default%3Arouter:decl=namespace%3Arouter:member=function%3AreplaceUrl:invoke=call:params=0%3ARouterOptions:ret=Promise%3Cvoid%3E",
    "api:official:openharmony:module=%40ohos.router:file=api%2F%40ohos.router.d.ets:export=default%3Arouter:decl=namespace%3Arouter:member=function%3AreplaceUrl:invoke=call:params=0%3ARouterOptions%2C1%3AAsyncCallback%3Cvoid%3E:ret=void",
    "api:official:openharmony:module=%40ohos.router:file=api%2F%40ohos.router.d.ets:export=default%3Arouter:decl=namespace%3Arouter:member=function%3AreplaceUrl:invoke=call:params=0%3ARouterOptions%2C1%3ARouterMode:ret=Promise%3Cvoid%3E",
    "api:official:openharmony:module=%40ohos.router:file=api%2F%40ohos.router.d.ets:export=default%3Arouter:decl=namespace%3Arouter:member=function%3AreplaceUrl:invoke=call:params=0%3ARouterOptions%2C1%3ARouterMode%2C2%3AAsyncCallback%3Cvoid%3E:ret=void",
];

const pushNamedRouteCanonicalApiIds = [
    "api:official:openharmony:module=%40ohos.router:file=api%2F%40ohos.router.d.ets:export=default%3Arouter:decl=namespace%3Arouter:member=function%3ApushNamedRoute:invoke=call:params=0%3ANamedRouterOptions:ret=Promise%3Cvoid%3E",
    "api:official:openharmony:module=%40ohos.router:file=api%2F%40ohos.router.d.ets:export=default%3Arouter:decl=namespace%3Arouter:member=function%3ApushNamedRoute:invoke=call:params=0%3ANamedRouterOptions%2C1%3AAsyncCallback%3Cvoid%3E:ret=void",
    "api:official:openharmony:module=%40ohos.router:file=api%2F%40ohos.router.d.ets:export=default%3Arouter:decl=namespace%3Arouter:member=function%3ApushNamedRoute:invoke=call:params=0%3ANamedRouterOptions%2C1%3ARouterMode:ret=Promise%3Cvoid%3E",
    "api:official:openharmony:module=%40ohos.router:file=api%2F%40ohos.router.d.ets:export=default%3Arouter:decl=namespace%3Arouter:member=function%3ApushNamedRoute:invoke=call:params=0%3ANamedRouterOptions%2C1%3ARouterMode%2C2%3AAsyncCallback%3Cvoid%3E:ret=void",
];

const replaceNamedRouteCanonicalApiIds = [
    "api:official:openharmony:module=%40ohos.router:file=api%2F%40ohos.router.d.ets:export=default%3Arouter:decl=namespace%3Arouter:member=function%3AreplaceNamedRoute:invoke=call:params=0%3ANamedRouterOptions:ret=Promise%3Cvoid%3E",
    "api:official:openharmony:module=%40ohos.router:file=api%2F%40ohos.router.d.ets:export=default%3Arouter:decl=namespace%3Arouter:member=function%3AreplaceNamedRoute:invoke=call:params=0%3ANamedRouterOptions%2C1%3AAsyncCallback%3Cvoid%3E:ret=void",
    "api:official:openharmony:module=%40ohos.router:file=api%2F%40ohos.router.d.ets:export=default%3Arouter:decl=namespace%3Arouter:member=function%3AreplaceNamedRoute:invoke=call:params=0%3ANamedRouterOptions%2C1%3ARouterMode:ret=Promise%3Cvoid%3E",
    "api:official:openharmony:module=%40ohos.router:file=api%2F%40ohos.router.d.ets:export=default%3Arouter:decl=namespace%3Arouter:member=function%3AreplaceNamedRoute:invoke=call:params=0%3ANamedRouterOptions%2C1%3ARouterMode%2C2%3AAsyncCallback%3Cvoid%3E:ret=void",
];

const getParamsCanonicalApiIds = [
    "api:official:openharmony:module=%40ohos.router:file=api%2F%40ohos.router.d.ets:export=default%3Arouter:decl=namespace%3Arouter:member=function%3AgetParams:invoke=call:params=none:ret=Object",
];

const getParamByNameCanonicalApiIds = [
    "api:official:arkui:module=%40internal%2Fcomponent%2Fets%2Fnavigation:file=api%2F%40internal%2Fcomponent%2Fets%2Fnavigation.d.ts:export=component%3ANavPathStack:decl=class%3ANavPathStack:member=method%3Ainstance%3AgetParamByName:invoke=call:params=0%3Astring:ret=Array%3Cunknown%3E",
    "api:official:arkui:module=%40internal%2Fcomponent%2Fets%2Fnavigation:file=api%2F%40internal%2Fcomponent%2Fets%2Fnavigation.d.ts:export=component%3ANavPathStack:decl=class%3ANavPathStack:member=method%3Ainstance%3AgetParamByName:invoke=call:params=0%3Astring:ret=Array%3CObject%20%7C%20null%20%7C%20undefined%3E",
    "api:official:arkui:module=api%2Farkui%2Fcomponent%2Fnavigation.d.ets:file=api%2Farkui%2Fcomponent%2Fnavigation.d.ets:export=named%3ANavPathStack:decl=class%3ANavPathStack:member=method%3Ainstance%3AgetParamByName:invoke=call:params=0%3Astring:ret=Array%3Cobject%3E",
];

const navDestinationRegisterCanonicalIds = [
    "api:official:arkui:module=%40internal%2Fcomponent%2Fets%2Fnavigation:file=api%2F%40internal%2Fcomponent%2Fets%2Fnavigation.d.ts:export=component%3ANavigation:decl=class%3ANavigationAttribute:member=method%3Ainstance%3AnavDestination:invoke=call:params=0%3A(name%3A%20string%2C%20param%3A%20unknown)%20%3D%3E%20void:ret=NavigationAttribute",
    "api:official:arkui:module=%40internal%2Fcomponent%2Fets%2Fnavigation:file=api%2F%40internal%2Fcomponent%2Fets%2Fnavigation.d.ts:export=component%3ANavigation:decl=class%3ANavigationAttribute:member=method%3Ainstance%3AnavDestination:invoke=call:params=0%3APageMapBuilder%20%7C%20undefined:ret=NavigationAttribute",
];

const navPathInfoTriggerCanonicalIds = [
    "api:official:arkui:module=%40internal%2Fcomponent%2Fets%2Fnavigation:file=api%2F%40internal%2Fcomponent%2Fets%2Fnavigation.d.ts:export=component%3ANavPathStack:decl=class%3ANavPathStack:member=method%3Ainstance%3ApushDestination:invoke=call:params=0%3ANavPathInfo%2C1%3A%3F%3Aboolean:ret=Promise%3Cvoid%3E",
    "api:official:arkui:module=%40internal%2Fcomponent%2Fets%2Fnavigation:file=api%2F%40internal%2Fcomponent%2Fets%2Fnavigation.d.ts:export=component%3ANavPathStack:decl=class%3ANavPathStack:member=method%3Ainstance%3ApushDestination:invoke=call:params=0%3ANavPathInfo%2C1%3A%3F%3ANavigationOptions:ret=Promise%3Cvoid%3E",
    "api:official:arkui:module=%40internal%2Fcomponent%2Fets%2Fnavigation:file=api%2F%40internal%2Fcomponent%2Fets%2Fnavigation.d.ts:export=component%3ANavPathStack:decl=class%3ANavPathStack:member=method%3Ainstance%3ApushPath:invoke=call:params=0%3ANavPathInfo%2C1%3A%3F%3Aboolean:ret=void",
    "api:official:arkui:module=%40internal%2Fcomponent%2Fets%2Fnavigation:file=api%2F%40internal%2Fcomponent%2Fets%2Fnavigation.d.ts:export=component%3ANavPathStack:decl=class%3ANavPathStack:member=method%3Ainstance%3ApushPath:invoke=call:params=0%3ANavPathInfo%2C1%3A%3F%3ANavigationOptions:ret=void",
    "api:official:arkui:module=%40internal%2Fcomponent%2Fets%2Fnavigation:file=api%2F%40internal%2Fcomponent%2Fets%2Fnavigation.d.ts:export=component%3ANavPathStack:decl=class%3ANavPathStack:member=method%3Ainstance%3AreplaceDestination:invoke=call:params=0%3ANavPathInfo%2C1%3A%3F%3ANavigationOptions:ret=Promise%3Cvoid%3E",
    "api:official:arkui:module=%40internal%2Fcomponent%2Fets%2Fnavigation:file=api%2F%40internal%2Fcomponent%2Fets%2Fnavigation.d.ts:export=component%3ANavPathStack:decl=class%3ANavPathStack:member=method%3Ainstance%3AreplacePath:invoke=call:params=0%3ANavPathInfo%2C1%3A%3F%3Aboolean:ret=void",
    "api:official:arkui:module=%40internal%2Fcomponent%2Fets%2Fnavigation:file=api%2F%40internal%2Fcomponent%2Fets%2Fnavigation.d.ts:export=component%3ANavPathStack:decl=class%3ANavPathStack:member=method%3Ainstance%3AreplacePath:invoke=call:params=0%3ANavPathInfo%2C1%3A%3F%3ANavigationOptions:ret=void",
    "api:official:arkui:module=api%2Farkui%2Fcomponent%2Fnavigation.d.ets:file=api%2Farkui%2Fcomponent%2Fnavigation.d.ets:export=named%3ANavPathStack:decl=class%3ANavPathStack:member=method%3Ainstance%3ApushDestination:invoke=call:params=0%3ANavPathInfo%2C1%3A%3F%3Aboolean:ret=Promise%3Cvoid%3E",
    "api:official:arkui:module=api%2Farkui%2Fcomponent%2Fnavigation.d.ets:file=api%2Farkui%2Fcomponent%2Fnavigation.d.ets:export=named%3ANavPathStack:decl=class%3ANavPathStack:member=method%3Ainstance%3ApushPath:invoke=call:params=0%3ANavPathInfo%2C1%3A%3F%3Aboolean:ret=void",
    "api:official:arkui:module=api%2Farkui%2Fcomponent%2Fnavigation.d.ets:file=api%2Farkui%2Fcomponent%2Fnavigation.d.ets:export=named%3ANavPathStack:decl=class%3ANavPathStack:member=method%3Ainstance%3AreplaceDestination:invoke=call:params=0%3ANavPathInfo%2C1%3A%3F%3ANavigationOptions:ret=Promise%3Cvoid%3E",
    "api:official:arkui:module=api%2Farkui%2Fcomponent%2Fnavigation.d.ets:file=api%2Farkui%2Fcomponent%2Fnavigation.d.ets:export=named%3ANavPathStack:decl=class%3ANavPathStack:member=method%3Ainstance%3AreplacePath:invoke=call:params=0%3ANavPathInfo%2C1%3A%3F%3Aboolean:ret=void",
];

const navByNameTriggerCanonicalIds = [
    "api:official:arkui:module=%40internal%2Fcomponent%2Fets%2Fnavigation:file=api%2F%40internal%2Fcomponent%2Fets%2Fnavigation.d.ts:export=component%3ANavPathStack:decl=class%3ANavPathStack:member=method%3Ainstance%3ApushDestinationByName:invoke=call:params=0%3Astring%2C1%3AObject%2C2%3A%3F%3Aboolean:ret=Promise%3Cvoid%3E",
    "api:official:arkui:module=%40internal%2Fcomponent%2Fets%2Fnavigation:file=api%2F%40internal%2Fcomponent%2Fets%2Fnavigation.d.ts:export=component%3ANavPathStack:decl=class%3ANavPathStack:member=method%3Ainstance%3ApushDestinationByName:invoke=call:params=0%3Astring%2C1%3AObject%2C2%3Aimport('..%2Fapi%2F%40ohos.base').Callback%3CPopInfo%3E%2C3%3A%3F%3Aboolean:ret=Promise%3Cvoid%3E",
    "api:official:arkui:module=%40internal%2Fcomponent%2Fets%2Fnavigation:file=api%2F%40internal%2Fcomponent%2Fets%2Fnavigation.d.ts:export=component%3ANavPathStack:decl=class%3ANavPathStack:member=method%3Ainstance%3ApushDestinationByName:invoke=call:params=0%3Astring%2C1%3AObject%2C2%3ACallback%3CPopInfo%3E%2C3%3A%3F%3Aboolean:ret=Promise%3Cvoid%3E",
    "api:official:arkui:module=%40internal%2Fcomponent%2Fets%2Fnavigation:file=api%2F%40internal%2Fcomponent%2Fets%2Fnavigation.d.ts:export=component%3ANavPathStack:decl=class%3ANavPathStack:member=method%3Ainstance%3ApushPathByName:invoke=call:params=0%3Astring%2C1%3Aunknown%2C2%3A%3F%3Aboolean:ret=void",
    "api:official:arkui:module=%40internal%2Fcomponent%2Fets%2Fnavigation:file=api%2F%40internal%2Fcomponent%2Fets%2Fnavigation.d.ts:export=component%3ANavPathStack:decl=class%3ANavPathStack:member=method%3Ainstance%3ApushPathByName:invoke=call:params=0%3Astring%2C1%3AObject%20%7C%20null%20%7C%20undefined%2C2%3A%3F%3Aboolean:ret=void",
    "api:official:arkui:module=%40internal%2Fcomponent%2Fets%2Fnavigation:file=api%2F%40internal%2Fcomponent%2Fets%2Fnavigation.d.ts:export=component%3ANavPathStack:decl=class%3ANavPathStack:member=method%3Ainstance%3ApushPathByName:invoke=call:params=0%3Astring%2C1%3AObject%2C2%3Aimport('..%2Fapi%2F%40ohos.base').Callback%3CPopInfo%3E%2C3%3A%3F%3Aboolean:ret=void",
    "api:official:arkui:module=%40internal%2Fcomponent%2Fets%2Fnavigation:file=api%2F%40internal%2Fcomponent%2Fets%2Fnavigation.d.ts:export=component%3ANavPathStack:decl=class%3ANavPathStack:member=method%3Ainstance%3ApushPathByName:invoke=call:params=0%3Astring%2C1%3AObject%2C2%3ACallback%3CPopInfo%3E%2C3%3A%3F%3Aboolean:ret=void",
    "api:official:arkui:module=%40internal%2Fcomponent%2Fets%2Fnavigation:file=api%2F%40internal%2Fcomponent%2Fets%2Fnavigation.d.ts:export=component%3ANavPathStack:decl=class%3ANavPathStack:member=method%3Ainstance%3AreplacePathByName:invoke=call:params=0%3Astring%2C1%3AObject%2C2%3A%3F%3Aboolean:ret=void",
    "api:official:arkui:module=api%2Farkui%2Fcomponent%2Fnavigation.d.ets:file=api%2Farkui%2Fcomponent%2Fnavigation.d.ets:export=named%3ANavPathStack:decl=class%3ANavPathStack:member=method%3Ainstance%3ApushDestinationByName:invoke=call:params=0%3Astring%2C1%3AObject%2C2%3A%3F%3Aboolean:ret=Promise%3Cvoid%3E",
    "api:official:arkui:module=api%2Farkui%2Fcomponent%2Fnavigation.d.ets:file=api%2Farkui%2Fcomponent%2Fnavigation.d.ets:export=named%3ANavPathStack:decl=class%3ANavPathStack:member=method%3Ainstance%3ApushPathByName:invoke=call:params=0%3Astring%2C1%3Aobject%2C2%3A%3F%3Aboolean:ret=void",
    "api:official:arkui:module=api%2Farkui%2Fcomponent%2Fnavigation.d.ets:file=api%2Farkui%2Fcomponent%2Fnavigation.d.ets:export=named%3ANavPathStack:decl=class%3ANavPathStack:member=method%3Ainstance%3AreplacePathByName:invoke=call:params=0%3Astring%2C1%3AObject%2C2%3A%3F%3Aboolean:ret=void",
];

const routerSurfaces = [
    ...pushCanonicalApiIds,
    ...pushUrlCanonicalApiIds,
    ...replaceCanonicalApiIds,
    ...replaceUrlCanonicalApiIds,
    ...pushNamedRouteCanonicalApiIds,
    ...replaceNamedRouteCanonicalApiIds,
    ...getParamsCanonicalApiIds,
    ...getParamByNameCanonicalApiIds,
    ...navDestinationRegisterCanonicalIds,
    ...navPathInfoTriggerCanonicalIds,
    ...navByNameTriggerCanonicalIds,
].map(officialInvokeSurfaceFromId);

const harmonyRouterModuleAsset = createBuiltinModuleAsset({
    id: "harmony.router",
    description: "Built-in Harmony router bridges.",
    semanticsFamily: "harmony-route-bridge",
    role: "handoff",
    capability: "module.route-bridge",
    surfaces: routerSurfaces,
    payload: {
        pushApis: [
            {
                canonicalApiIds: pushCanonicalApiIds,
                routeField: "url",
                payloadArgIndex: 0,
                payloadField: "params",
            },
            {
                canonicalApiIds: pushUrlCanonicalApiIds,
                routeField: "url",
                payloadArgIndex: 0,
                payloadField: "params",
            },
            {
                canonicalApiIds: replaceCanonicalApiIds,
                routeField: "url",
                payloadArgIndex: 0,
                payloadField: "params",
            },
            {
                canonicalApiIds: replaceUrlCanonicalApiIds,
                routeField: "url",
                payloadArgIndex: 0,
                payloadField: "params",
            },
            {
                canonicalApiIds: pushNamedRouteCanonicalApiIds,
                routeField: "name",
                payloadArgIndex: 0,
                payloadField: "params",
            },
            {
                canonicalApiIds: replaceNamedRouteCanonicalApiIds,
                routeField: "name",
                payloadArgIndex: 0,
                payloadField: "params",
            },
            {
                canonicalApiIds: navPathInfoTriggerCanonicalIds,
                routeField: "name",
                payloadArgIndex: 0,
                payloadField: "param",
            },
            {
                canonicalApiIds: navByNameTriggerCanonicalIds,
                routeField: "name",
                routeArgIndex: 0,
                payloadArgIndex: 1,
            },
        ],
        getCanonicalApiIds: getParamsCanonicalApiIds,
        getApis: [
            {
                canonicalApiIds: getParamByNameCanonicalApiIds,
                routeField: "name",
                routeArgIndex: 0,
            },
        ],
        navDestinationRegisterApis: [
            {
                canonicalApiIds: navDestinationRegisterCanonicalIds,
                callbackArgIndex: 0,
                routeParamIndex: 0,
                payloadParamIndex: 1,
            },
        ],
        navDestinationTriggerApis: [
            {
                canonicalApiIds: navPathInfoTriggerCanonicalIds,
                routeField: "name",
                payloadArgIndex: 0,
                payloadField: "param",
            },
            {
                canonicalApiIds: navByNameTriggerCanonicalIds,
                routeField: "name",
                routeArgIndex: 0,
                payloadArgIndex: 1,
            },
        ],
        payloadUnwrapPrefixes: ["param", "params"],
    },
});

export default harmonyRouterModuleAsset;
