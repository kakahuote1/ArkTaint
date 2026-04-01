import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import geoLocationManager from '@ohos.geoLocationManager';
import FormExtensionAbility from '@ohos.app.form.FormExtensionAbility';

export default class EntryAbility extends UIAbility {
  info: string = ''

  onShare(wantParam: Record<string, Object>): void {
    hilog.info(0x0000, 'testTag', '%{public}s', this.info); //sink, leak
    this.info = JSON.stringify(geoLocationManager.getLastLocation()); //source
  }
}
