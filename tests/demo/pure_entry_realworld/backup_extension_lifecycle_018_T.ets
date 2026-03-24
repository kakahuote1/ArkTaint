// Case: BackupExtensionAbility with onBackup/onRestore
// Real pattern: app data backup and restore lifecycle
import { BackupExtensionAbility, taint } from "./taint_mock";

export default class SmartHomeBackup extends BackupExtensionAbility {
    onBackup(): void {
        const sensitiveData = this.collectAppState();
        taint.Sink(sensitiveData);
    }

    onRestore(bundleVersion: any): void {
        taint.Sink(bundleVersion);
        this.applyRestoredState(bundleVersion);
    }

    private collectAppState(): string {
        return taint.Source();
    }

    private applyRestoredState(data: any): void {
        taint.Sink(data);
    }
}
