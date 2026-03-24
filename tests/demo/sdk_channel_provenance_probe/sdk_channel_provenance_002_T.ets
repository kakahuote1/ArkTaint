import router from "@ohos.router";
import SystemRouter from "@system.router";

function sdk_channel_provenance_002_T(): void {
    router.getParams();
    router.pushUrl({ url: "pages/direct-ohos", params: { token: "z" } });

    SystemRouter.getParams();
    SystemRouter.pushUrl({ url: "pages/direct-system", params: { token: "w" } });
}

export { sdk_channel_provenance_002_T };
