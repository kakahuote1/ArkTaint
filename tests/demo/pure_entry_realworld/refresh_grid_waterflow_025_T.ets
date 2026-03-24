// Case: Refresh pull-to-refresh + Grid and WaterFlow scroll callbacks
// Real pattern: device gallery with pull-to-refresh and infinite scroll
import { Refresh, Grid, WaterFlow, taint } from "./taint_mock";

class DeviceGallery {
    private isRefreshing: boolean = false;
    private currentPage: number = 0;

    build(): void {
        // Pull-to-refresh container
        const refresh = new Refresh();
        refresh.onRefreshing(() => {
            this.isRefreshing = true;
            this.fetchDevices(0).then(() => {
                this.isRefreshing = false;
            });
        });
        refresh.onStateChange((state: number) => {
            taint.Sink(state);
        });

        // Grid layout for devices
        const grid = new Grid();
        grid.onScrollIndex((first: number) => {
            taint.Sink(first);
        });
        grid.onReachStart(() => {
            taint.Sink("grid_top");
        });
        grid.onReachEnd(() => {
            this.currentPage++;
            this.fetchDevices(this.currentPage);
        });

        // WaterFlow for mixed-size cards
        const waterFlow = new WaterFlow();
        waterFlow.onReachStart(() => {
            taint.Sink("waterflow_top");
        });
        waterFlow.onReachEnd(() => {
            taint.Sink("waterflow_bottom");
            this.loadMoreCards();
        });
        waterFlow.onScrollIndex((first: number, last: number) => {
            taint.Sink(`visible: ${first}-${last}`);
        });
    }

    private async fetchDevices(page: number): Promise<void> {
        taint.Sink(page);
    }

    private loadMoreCards(): void {
        taint.Sink("loading_cards");
    }
}

export { DeviceGallery };
