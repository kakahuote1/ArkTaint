import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { window } from '@kit.ArkUI';
import deviceInfo from '@ohos.deviceInfo';
import geoLocationManager from '@ohos.geoLocationManager';
import sim from '@ohos.telephony.sim'

class A{
  str: string = ''

  taint(s: string) {
    this.str = s;
  }
}

export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    const a = new A();
    const b = a;
    a.taint(JSON.stringify(geoLocationManager.getLastLocation())); //source
    hilog.info(0x0000, 'testTag', '%{public}s', b.str); //sink, leak
  }
}

