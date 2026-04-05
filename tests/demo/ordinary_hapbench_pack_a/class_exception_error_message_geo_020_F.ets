import geoLocationManager from "@ohos.geoLocationManager";
import { hilog } from "@kit.PerformanceAnalysisKit";

export function class_exception_error_message_geo_020_F(): void {
    try {
        const info = JSON.stringify(geoLocationManager.getLastLocation());
        void info;
        throw new Error("safe");
    } catch (err: any) {
        hilog.info(0x0000, "testTag", "%{public}s", err.message);
    }
}
