// Case: CustomDialog with cancel/confirm callbacks + animateTo
// Real pattern: confirmation dialog for device operations
import { CustomDialogController, animateTo, taint } from "./taint_mock";

class DeviceRemoveDialog {
    private deviceName: string = "";
    private dialogVisible: boolean = false;

    build(): void {
        const dialog = new CustomDialogController({
            builder: () => {
                this.buildDialogContent();
            },
            cancel: () => {
                animateTo({ duration: 200, onFinish: () => {
                    this.dialogVisible = false;
                }}, () => {
                    // fade out animation
                });
            },
            confirm: () => {
                taint.Sink(this.deviceName);
                this.removeDevice(this.deviceName);
                animateTo({ duration: 200, onFinish: () => {
                    this.dialogVisible = false;
                    this.refreshDeviceList();
                }}, () => {
                    // slide out animation
                });
            },
            autoCancel: true,
        });

        dialog.open();
    }

    private buildDialogContent(): void {
        taint.Sink("Are you sure you want to remove " + this.deviceName + "?");
    }

    private removeDevice(name: string): void {
        taint.Sink(name);
    }

    private refreshDeviceList(): void {}
}

export { DeviceRemoveDialog };
