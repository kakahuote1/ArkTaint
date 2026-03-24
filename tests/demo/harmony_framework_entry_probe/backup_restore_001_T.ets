import { BackupExtensionAbility, taint } from "./taint_mock";

class ProbeBackupExtension extends BackupExtensionAbility {
    onRestore(_payload: any): void {
        taint.Sink(taint.Source());
    }
}

export function backup_restore_001_T(): void {
    void ProbeBackupExtension;
}
