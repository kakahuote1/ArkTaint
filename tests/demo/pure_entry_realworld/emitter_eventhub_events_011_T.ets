// Case: Emitter + EventHub cross-component event communication
// Real apps use event channels for decoupled component communication
import { Emitter, EventHub, taint } from "./taint_mock";

class DeviceListPage {
    private eventHub: EventHub;
    private devices: string[] = [];

    constructor() {
        this.eventHub = new EventHub();
    }

    aboutToAppear(): void {
        // Global emitter subscription
        Emitter.on("device_discovered", (data: any) => {
            this.devices.push(data?.name);
            taint.Sink(data?.name);
        });

        Emitter.on("device_removed", (data: any) => {
            taint.Sink(data?.id);
        });

        // Local EventHub for parent-child communication
        this.eventHub.on("device_selected", (deviceId: string) => {
            taint.Sink(deviceId);
            this.navigateToDetail(deviceId);
        });

        this.eventHub.on("refresh_requested", () => {
            this.refreshDevices();
        });
    }

    build(): void {
        // emit events from the list
        Emitter.emit("page_loaded", { page: "device_list" });
    }

    private navigateToDetail(deviceId: string): void {
        taint.Sink(deviceId);
    }

    private refreshDevices(): void {
        taint.Sink("refreshing");
    }
}

export { DeviceListPage };
