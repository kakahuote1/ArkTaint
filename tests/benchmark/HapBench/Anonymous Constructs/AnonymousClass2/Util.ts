
import { hilog } from '@kit.PerformanceAnalysisKit';
import geoLocationManager from '@ohos.geoLocationManager';


export function taint() {
  let a = {
    info: JSON.stringify(geoLocationManager.getLastLocation()), //source
  }
  let b = {
    n: zero(a),
  }
}

function zero(a: {info}): number {
  hilog.info(0x0000, 'testTag', '%{public}s', a.info); //sink, leak
  return 0;
}