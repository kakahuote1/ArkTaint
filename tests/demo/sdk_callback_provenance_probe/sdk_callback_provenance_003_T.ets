import media from "@ohos.multimedia.media";

function sdk_callback_provenance_003_T(): void {
    let player!: media.AVPlayer;

    player.on("stateChange", (state) => {
        console.info(state);
    });

    player.on("volumeChange", (volume) => {
        console.info(volume);
    });
}

export { sdk_callback_provenance_003_T };
