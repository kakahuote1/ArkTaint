// Case: AbilityStage advanced lifecycle: onAcceptWant for singleton routing + onMemoryLevel
// Real pattern: app-level lifecycle management
import { AbilityStage, Want, taint } from "./taint_mock";

export default class SmartHomeAppStage extends AbilityStage {
    private memoryPressure: number = 0;
    private activeAbilityCount: number = 0;

    onCreate(): void {
        this.activeAbilityCount = 0;
        taint.Sink("app_stage_init");
    }

    // Called when a specified-instance ability is started
    onAcceptWant(want: Want): string {
        const targetModule = want.parameters?.["module"];
        const targetAbility = want.parameters?.["ability"];
        taint.Sink(`routing: ${targetModule}/${targetAbility}`);

        // Return instance key for singleton management
        if (targetAbility === "DeviceDetail") {
            const deviceId = want.parameters?.["device_id"];
            taint.Sink(deviceId);
            return `DeviceDetail_${deviceId}`;
        }
        return "";
    }

    // Called when system memory is low
    onMemoryLevel(level: number): void {
        this.memoryPressure = level;
        taint.Sink(level);
        if (level > 1) {
            this.releaseResources(level);
        }
    }

    private releaseResources(severity: number): void {
        taint.Sink(`releasing resources, severity=${severity}`);
    }
}
