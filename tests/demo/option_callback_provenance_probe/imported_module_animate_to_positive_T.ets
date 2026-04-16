import { animateTo } from "./module_animation";

function imported_module_animate_to_positive_T(): void {
    animateTo({
        duration: 200,
        onFinish: () => {
            console.info("done");
        },
    }, () => {
        console.info("tick");
    });
}

export { imported_module_animate_to_positive_T };
