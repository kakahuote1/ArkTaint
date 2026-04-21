import geoLocationManager from "@ohos.geoLocationManager";
import { hilog } from "@kit.PerformanceAnalysisKit";

function invokeNow(callback: () => void): void {
    callback();
}

export function class_callback_writeback_geo_017_T(): void {
    let out = "";
    invokeNow((): void => {
        out = JSON.stringify(geoLocationManager.getLastLocation());
    });
    hilog.info(0x0000, "testTag", "%{public}s", out);
}
