// Case: AlertDialog with primary/secondary buttons + ActionSheet with dynamic actions
// Real pattern: device control confirmation and action menus
import { AlertDialog, ActionSheet, taint } from "./taint_mock";

class DeviceActionMenu {
    private selectedDeviceId: string = "";

    build(): void {
        // AlertDialog for dangerous actions
        AlertDialog.show({
            title: "Remove Device",
            message: "This will remove the device permanently.",
            primaryButton: {
                value: "Cancel",
                action: () => {
                    taint.Sink("user_cancelled");
                },
            },
            secondaryButton: {
                value: "Remove",
                action: () => {
                    taint.Sink(this.selectedDeviceId);
                    this.removeDevice(this.selectedDeviceId);
                },
            },
            cancel: () => {
                taint.Sink("dialog_dismissed");
            },
        });

        // ActionSheet for multiple options
        ActionSheet.show({
            title: "Device Actions",
            sheets: [
                {
                    title: "Rename",
                    action: () => {
                        taint.Sink("rename_action");
                        this.renameDevice(this.selectedDeviceId);
                    },
                },
                {
                    title: "Move to Room",
                    action: () => {
                        taint.Sink("move_action");
                    },
                },
                {
                    title: "Share Device",
                    action: () => {
                        taint.Sink("share_action");
                    },
                },
                {
                    title: "Reset",
                    action: () => {
                        taint.Sink("reset_action");
                        this.resetDevice(this.selectedDeviceId);
                    },
                },
            ],
            cancel: () => {
                taint.Sink("sheet_cancelled");
            },
        });
    }

    private removeDevice(id: string): void { taint.Sink(id); }
    private renameDevice(id: string): void { taint.Sink(id); }
    private resetDevice(id: string): void { taint.Sink(id); }
}

export { DeviceActionMenu };
