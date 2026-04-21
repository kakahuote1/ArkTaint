import geoLocationManager from "@ohos.geoLocationManager";
import { hilog } from "@kit.PerformanceAnalysisKit";

export function class_exception_error_message_geo_019_T(): void {
    try {
        const info = JSON.stringify(geoLocationManager.getLastLocation());
        throw new Error(info);
    } catch (err: any) {
        hilog.info(0x0000, "testTag", "%{public}s", err.message);
    }
}
