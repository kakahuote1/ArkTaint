import geoLocationManager from "@ohos.geoLocationManager";
import { hilog } from "@kit.PerformanceAnalysisKit";

function relay(obj: { info: string; safe: string }): void {
    hilog.info(0x0000, "testTag", "%{public}s", obj.safe);
}

export function class_object_literal_param_geo_016_F(): void {
    const obj = {
        info: JSON.stringify(geoLocationManager.getLastLocation()),
        safe: "safe",
    };
    relay(obj);
}
