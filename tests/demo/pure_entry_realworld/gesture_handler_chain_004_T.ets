// Case: Component with multiple gesture recognizers
// Real apps use gesture chains for drag-to-reorder, pinch-to-zoom, etc.
import {
    TapGesture, LongPressGesture, PanGesture,
    PinchGesture, SwipeGesture, taint,
} from "./taint_mock";

class DeviceControlPanel {
    private selectedDevice: string = "";
    private zoomLevel: number = 1.0;

    build(): void {
        const tap = new TapGesture();
        tap.onAction((event) => {
            this.selectedDevice = event?.target?.id || "";
            taint.Sink(this.selectedDevice);
        });

        const longPress = new LongPressGesture();
        longPress.onAction((event) => {
            const deviceData = event?.target?.data;
            taint.Sink(deviceData);
        });
        longPress.onActionEnd((event) => {
            void event;
        });

        const pan = new PanGesture();
        pan.onActionStart((event) => {
            taint.Sink(event?.offsetX);
        });
        pan.onActionUpdate((event) => {
            taint.Sink(event?.offsetY);
        });
        pan.onActionEnd(() => {});

        const pinch = new PinchGesture();
        pinch.onActionUpdate((event) => {
            this.zoomLevel = event?.scale || 1.0;
            taint.Sink(this.zoomLevel);
        });

        const swipe = new SwipeGesture();
        swipe.onAction((event) => {
            taint.Sink(event?.angle);
        });
    }
}

export { DeviceControlPanel };
