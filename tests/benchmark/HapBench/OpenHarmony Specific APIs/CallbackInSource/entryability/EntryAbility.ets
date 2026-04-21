import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';
import sim from '@ohos.telephony.sim';
import commonEventManager from '@ohos.commonEventManager';
import { hilog } from '@kit.PerformanceAnalysisKit';

export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    sim.getSimAccountInfo(0, (err, account) => {
      hilog.info(0x0000, "", "", account);
    });
  }

}


