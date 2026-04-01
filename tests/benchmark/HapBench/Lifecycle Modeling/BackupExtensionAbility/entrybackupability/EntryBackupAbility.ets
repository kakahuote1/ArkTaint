import { hilog } from '@kit.PerformanceAnalysisKit';
import { BackupExtensionAbility, BundleVersion } from '@kit.CoreFileKit';
import geoLocationManager from '@ohos.geoLocationManager';

export default class EntryBackupAbility extends BackupExtensionAbility {
  info: string = ''
  async onBackup() {
    this.info = JSON.stringify(geoLocationManager.getLastLocation()); //source
  }

  async onRestore(bundleVersion: BundleVersion) {
    hilog.info(0x0000, 'testTag', '%{public}s', this.info); //sink, leak
  }
}