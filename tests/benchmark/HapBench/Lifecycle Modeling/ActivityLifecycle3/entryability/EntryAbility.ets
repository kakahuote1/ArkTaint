import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import geoLocationManager from '@ohos.geoLocationManager';
import window from '@ohos.window';

export default class EntryAbility extends UIAbility {
  info: string = ''
  onWindowStageCreate(windowStage: window.WindowStage): void {
    this.info = JSON.stringify(geoLocationManager.getLastLocation()); //source
  }

  onWindowStageWillDestroy(windowStage: window.WindowStage): void {
    hilog.info(0x0000, 'testTag', '%{public}s', this.info); //sink, leak
  }
}
