// Case: LazyForEach with full IDataSource implementation
// Real pattern: virtualized list with data source providing callbacks
import { IDataSource, taint, Button } from "./taint_mock";

interface DeviceInfo {
    id: string;
    name: string;
    status: string;
}

class DeviceDataSource implements IDataSource {
    private devices: DeviceInfo[] = [];
    private listeners: any[] = [];

    totalCount(): number {
        return this.devices.length;
    }

    getData(index: number): DeviceInfo {
        const device = this.devices[index];
        taint.Sink(device?.id);
        return device;
    }

    registerDataChangeListener(listener: any): void {
        this.listeners.push(listener);
    }

    unregisterDataChangeListener(listener: any): void {
        const idx = this.listeners.indexOf(listener);
        if (idx >= 0) this.listeners.splice(idx, 1);
    }

    addDevice(device: DeviceInfo): void {
        this.devices.push(device);
        for (const listener of this.listeners) {
            listener?.onDataAdd?.(this.devices.length - 1);
        }
    }

    notifyDataReload(): void {
        for (const listener of this.listeners) {
            listener?.onDataReloaded?.();
        }
    }
}

class DeviceListView {
    private dataSource: DeviceDataSource;

    constructor() {
        this.dataSource = new DeviceDataSource();
    }

    aboutToAppear(): void {
        this.dataSource.addDevice({ id: taint.Source(), name: "Light", status: "on" });
        this.dataSource.addDevice({ id: "dev2", name: "Thermostat", status: "off" });
    }

    build(): void {
        // simulating LazyForEach rendering
        for (let i = 0; i < this.dataSource.totalCount(); i++) {
            const item = this.dataSource.getData(i);
            const btn = new Button();
            btn.onClick(() => {
                taint.Sink(item?.id);
            });
        }
    }
}

export { DeviceDataSource, DeviceListView };
