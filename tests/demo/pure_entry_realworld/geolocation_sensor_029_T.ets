// Case: Geolocation + Sensor subscriptions for device location awareness
// Real pattern: smart home automation based on user location and environment sensors
import { Geolocation, Sensor, taint } from "./taint_mock";

const SENSOR_ACCELEROMETER = 1;
const SENSOR_LIGHT = 5;
const SENSOR_PROXIMITY = 8;

class LocationAwareAutomation {
    private lastLatitude: number = 0;
    private lastLongitude: number = 0;
    private ambientLight: number = 0;

    aboutToAppear(): void {
        // Geolocation subscription
        Geolocation.on("locationChange", { priority: 0x203 }, (location) => {
            this.lastLatitude = location.latitude;
            this.lastLongitude = location.longitude;
            taint.Sink(`${location.latitude},${location.longitude}`);
            this.checkGeofence(location.latitude, location.longitude);
        });

        // Accelerometer for shake detection
        Sensor.on(SENSOR_ACCELEROMETER, (data: any) => {
            taint.Sink(data?.x + data?.y + data?.z);
            if (this.isShake(data)) {
                this.triggerQuickAction();
            }
        }, { interval: 200000000 });

        // Light sensor for automatic brightness
        Sensor.on(SENSOR_LIGHT, (data: any) => {
            this.ambientLight = data?.intensity || 0;
            taint.Sink(this.ambientLight);
            this.adjustLighting(this.ambientLight);
        });

        // Proximity sensor for screen-off automation
        Sensor.on(SENSOR_PROXIMITY, (data: any) => {
            taint.Sink(data?.distance);
        });
    }

    build(): void {
        taint.Sink(`Location: ${this.lastLatitude},${this.lastLongitude}`);
    }

    private checkGeofence(lat: number, lon: number): void {
        taint.Sink(`geofence check: ${lat},${lon}`);
    }

    private isShake(data: any): boolean {
        const magnitude = Math.sqrt(data?.x ** 2 + data?.y ** 2 + data?.z ** 2);
        return magnitude > 15;
    }

    private triggerQuickAction(): void {
        taint.Sink("shake_detected");
    }

    private adjustLighting(intensity: number): void {
        taint.Sink(intensity);
    }
}

export { LocationAwareAutomation };
