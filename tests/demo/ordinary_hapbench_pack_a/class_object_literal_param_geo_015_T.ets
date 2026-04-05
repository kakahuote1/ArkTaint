import geoLocationManager from "@ohos.geoLocationManager";
import { hilog } from "@kit.PerformanceAnalysisKit";

function relay(obj: { info: string }): void {
    hilog.info(0x0000, "testTag", "%{public}s", obj.info);
}

export function class_object_literal_param_geo_015_T(): void {
    const obj = {
        info: JSON.stringify(geoLocationManager.getLastLocation()),
    };
    relay(obj);
}
