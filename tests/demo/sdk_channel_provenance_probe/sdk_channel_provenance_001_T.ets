import { AppStorageV2, Router, router } from "@kit.ArkUI";

class ProbeState {
    token: string = "safe";
}

function sdk_channel_provenance_001_T(): void {
    Router.getParams();
    Router.pushUrl({ url: "pages/detail", params: { token: "x" } });

    router.getParams();
    router.pushUrl({ url: "pages/detail2", params: { token: "y" } });

    AppStorageV2.connect(ProbeState, "token", () => new ProbeState());
}

export { sdk_channel_provenance_001_T };
