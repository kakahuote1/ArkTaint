import { hilog } from '@kit.PerformanceAnalysisKit';
import { BackupExtensionAbility, BundleVersion } from '@kit.CoreFileKit';

export default class EntryBackupAbility extends BackupExtensionAbility {
  async onBackup() {
    hilog.info(0x0000, 'testTag', 'onBackup ok');
  }

  async onRestore(bundleVersion: BundleVersion) {
    const restoreSnapshot = JSON.stringify(bundleVersion);
    hilog.info(0x0000, 'testTag', 'onRestore ok');
    console.info(restoreSnapshot);
  }
}
