import { BackupExtensionAbility, taint } from "./taint_mock";

class ProbeBackupExtension extends BackupExtensionAbility {
    restore(payload: any): void {
        taint.Sink(payload);
    }
}

export function backup_restore_002_F(): void {
    void ProbeBackupExtension;
}
