// Case: Multi-ability chain with want data flowing through 3 abilities
// Ability A -> startAbility -> Ability B -> startAbilityForResult -> Ability C
import { UIAbility, Want, taint, AbilityContext } from "./taint_mock";

class LauncherAbility extends UIAbility {
    onCreate(want: Want, launchParam: any): void {
        void launchParam;
        const deeplink = want.parameters?.["deeplink_url"];
        const targetWant = new Want({ device_id: deeplink, hop: 1 });
        this.context.startAbility(targetWant);
    }
}

class DeviceAbility extends UIAbility {
    onCreate(want: Want, launchParam: any): void {
        void launchParam;
        const deviceId = want.parameters?.["device_id"];
        const hop = want.parameters?.["hop"];
        taint.Sink(deviceId);
        const controlWant = new Want({ device_id: deviceId, operation: "control", hop: hop + 1 });
        this.context.startAbilityForResult(controlWant);
    }

    onNewWant(want: Want): void {
        const updated = want.parameters?.["device_id"];
        taint.Sink(updated);
    }
}

class ControlAbility extends UIAbility {
    onCreate(want: Want, launchParam: any): void {
        void launchParam;
        const deviceId = want.parameters?.["device_id"];
        const operation = want.parameters?.["operation"];
        const hop = want.parameters?.["hop"];
        taint.Sink(`${deviceId}:${operation}:hop=${hop}`);
    }

    onForeground(): void {
        // resume control session
    }

    onBackground(): void {
        // pause control session
    }
}

export { LauncherAbility, DeviceAbility, ControlAbility };
