import { animateTo } from "./wrong_shape";

function imported_wrong_shape_negative_F(): void {
    animateTo({
        duration: 200,
        done: () => {
            console.info("done");
        },
    }, () => {
        console.info("tick");
    });
}

export { imported_wrong_shape_negative_F };
