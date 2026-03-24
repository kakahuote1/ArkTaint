// Case: List and Swiper with scroll/drag/interaction callbacks
// Real pattern: scrollable device list with pull-to-refresh and item interactions
import { List, Swiper, Button, taint } from "./taint_mock";

class DeviceCarousel {
    private currentIndex: number = 0;
    private scrollOffset: number = 0;
    private isRefreshing: boolean = false;

    build(): void {
        // Swiper for featured devices
        const swiper = new Swiper();
        swiper.onChange((index: number) => {
            this.currentIndex = index;
            taint.Sink(index);
        });
        swiper.onAnimationStart((index: number) => {
            taint.Sink(index);
        });
        swiper.onAnimationEnd((index: number) => {
            this.loadDeviceDetails(index);
        });

        // Scrollable device list
        const list = new List();
        list.onScroll((offset: number, state: number) => {
            this.scrollOffset = offset;
            taint.Sink(state);
        });
        list.onScrollIndex((start: number, end: number) => {
            taint.Sink(`visible: ${start}-${end}`);
        });
        list.onReachStart(() => {
            this.isRefreshing = true;
            this.refreshDevices();
        });
        list.onReachEnd(() => {
            this.loadMoreDevices();
        });

        // Item interaction
        const item = new Button();
        item.onClick((event: any) => {
            taint.Sink(event);
        });
        item.onTouch((event: any) => {
            taint.Sink(event?.type);
        });
        item.onAppear(() => {
            taint.Sink("item_appeared");
        });
    }

    aboutToAppear(): void {
        this.loadDeviceDetails(0);
    }

    private loadDeviceDetails(index: number): void {
        taint.Sink(index);
    }

    private refreshDevices(): void {
        taint.Sink("refresh");
        this.isRefreshing = false;
    }

    private loadMoreDevices(): void {
        taint.Sink("load_more");
    }
}

export { DeviceCarousel };
