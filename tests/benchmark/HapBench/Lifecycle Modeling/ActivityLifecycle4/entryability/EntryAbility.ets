import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import geoLocationManager from '@ohos.geoLocationManager';
import radio from '@ohos.telephony.radio';
import Generalbility from './GeneralAbility';


export default class EntryAbility extends Generalbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    super.onCreate(want, launchParam);
    hilog.info(0x0000, 'testTag', '%{public}s', EntryAbility.info); //sink, leak
  }
}

namespace a {
  class c {
    p: number = 0;
  }
}
