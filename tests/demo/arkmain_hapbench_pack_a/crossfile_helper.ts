import geoLocationManager from "@ohos.geoLocationManager";
import { hilog } from "@kit.PerformanceAnalysisKit";

export function emitGeoObjectLiteralFromHelper(): void {
    const obj = {
        info: JSON.stringify(geoLocationManager.getLastLocation()),
    };
    const wrapped = {
        count: forwardToSink(obj),
    };
    void wrapped;
}

export function emitSafeObjectLiteralFromHelper(): void {
    const obj = {
        info: JSON.stringify(geoLocationManager.getLastLocation()),
        safe: "safe",
    };
    const wrapped = {
        count: forwardSafeField(obj),
    };
    void wrapped;
}

function forwardToSink(obj: { info: string }): number {
    hilog.info(0x0000, "testTag", "%{public}s", obj.info);
    return 0;
}

function forwardSafeField(obj: { info: string; safe: string }): number {
    hilog.info(0x0000, "testTag", "%{public}s", obj.safe);
    return 0;
}
