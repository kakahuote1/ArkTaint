import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import geoLocationManager from '@ohos.geoLocationManager';



export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    let info = JSON.stringify(geoLocationManager.getLastLocation()); //source
    const regex = /(.*)/;
    const match = regex.exec(info);

    if (match) {
      const matchedString = match[1];
      hilog.info(0x0000, 'testTag', '%{public}s', matchedString); //sink, leak
      console.log("Matched IMEI:",);
    }
  }
}
