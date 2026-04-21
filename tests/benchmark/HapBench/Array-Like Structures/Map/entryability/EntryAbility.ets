import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';
import deviceInfo from '@ohos.deviceInfo';
import geoLocationManager from '@ohos.geoLocationManager';
import sim from '@ohos.telephony.sim'
import { hilog } from '@kit.PerformanceAnalysisKit';

export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    let m: Map<string, string> = new Map();
    m.set('tiant', JSON.stringify(geoLocationManager.getLastLocation()));//source

    hilog.info(0x0000, 'testTag', '%{public}s', m.get('tiant')); //sink, leak
  }
}
