import geoLocationManager from "@ohos.geoLocationManager";
import { hilog } from "@kit.PerformanceAnalysisKit";

export function class_map_direct_view_geo_raw_023_T(): void {
    let m: Map<string, string> = new Map();
    m.set("k", JSON.stringify(geoLocationManager.getLastLocation()));
    hilog.info(0x0000, "testTag", "%{public}s", m.get("k"));
}
