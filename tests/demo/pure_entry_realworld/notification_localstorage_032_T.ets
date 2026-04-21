// Case: Notification subscription + LocalStorage cross-page sharing
// Real pattern: receiving push notifications and storing state across pages
import { NotificationManager, LocalStorage, AppStorage, taint } from "./taint_mock";

class NotificationDashboard {
    private localStorage: LocalStorage;
    private unreadCount: number = 0;

    constructor() {
        this.localStorage = new LocalStorage({ unreadCount: 0, lastNotification: "" });
    }

    aboutToAppear(): void {
        // Notification subscription
        NotificationManager.subscribe(
            { slotType: 1, actions: ["view", "dismiss"] },
            (err: any, data: any) => {
                if (err) {
                    taint.Sink(err);
                    return;
                }
                const notification = data?.request?.content;
                taint.Sink(notification?.title);
                taint.Sink(notification?.text);
                this.handleNotification(data);
            }
        );

        // AppStorage cross-page state
        const userId = AppStorage.get("currentUserId");
        taint.Sink(userId);

        // LocalStorage for page-level state
        const saved = this.localStorage.get("lastNotification");
        taint.Sink(saved);
    }

    build(): void {
        this.localStorage.set("unreadCount", this.unreadCount);
        const linked = this.localStorage.link("lastNotification");
        taint.Sink(linked);

        AppStorage.setOrCreate("notificationBadge", this.unreadCount);
    }

    private handleNotification(data: any): void {
        this.unreadCount++;
        const actionType = data?.actionType;
        taint.Sink(actionType);
        this.localStorage.set("lastNotification", data?.request?.content?.text);
    }
}

export { NotificationDashboard };
