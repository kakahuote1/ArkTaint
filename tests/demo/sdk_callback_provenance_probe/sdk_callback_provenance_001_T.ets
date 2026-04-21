import sensor from "@ohos.sensor";
import media from "@ohos.multimedia.media";

function sdk_callback_provenance_001_T(): void {
    sensor.on(sensor.SensorId.ACCELEROMETER, (data) => {
        console.info(data.x);
    });

    media.createAVPlayer((err, player) => {
        if (err || !player) {
            console.error(err);
            return;
        }

        player.on("stateChange", (state, reason) => {
            console.info(state, reason);
        });

        player.on("volumeChange", (volume) => {
            console.info(volume);
        });
    });
}

export { sdk_callback_provenance_001_T };
