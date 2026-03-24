// Case: Drag and drop handlers on a device grid
// Real pattern: reorder rooms/devices by drag, accept drops from other components
import { DragEvent, taint } from "./taint_mock";

class RoomGridLayout {
    private rooms: string[] = ["Living Room", "Bedroom", "Kitchen"];
    private draggedIndex: number = -1;

    build(): void {
        // Each room card has drag handlers
        this.buildRoomCard(0);
    }

    aboutToAppear(): void {
        this.rooms = this.loadSavedLayout();
    }

    private buildRoomCard(index: number): void {
        void index;
        // simulating .onDragStart / .onDragEnter / .onDragMove / .onDragLeave / .onDrop
        this.onDragStart(index);
    }

    onDragStart(index: number): any {
        this.draggedIndex = index;
        const roomName = this.rooms[index];
        taint.Sink(roomName);
        return { roomIndex: index, name: roomName };
    }

    onDragEnter(event: DragEvent): void {
        const data = event.getData();
        taint.Sink(data);
    }

    onDragMove(event: DragEvent): void {
        taint.Sink(event.getSummary());
    }

    onDragLeave(): void {
        // reset highlight
    }

    onDrop(event: DragEvent): void {
        const data = event.getData();
        taint.Sink(data);
        this.reorderRooms(this.draggedIndex, data);
    }

    private reorderRooms(fromIndex: number, data: string): void {
        taint.Sink(`reorder: ${fromIndex} -> ${data}`);
    }

    private loadSavedLayout(): string[] {
        return [taint.Source()];
    }
}

export { RoomGridLayout };
