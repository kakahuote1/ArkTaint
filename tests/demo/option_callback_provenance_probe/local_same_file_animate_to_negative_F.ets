function animateTo(
    params: { duration: number; onFinish?: () => void },
    cb: () => void,
): void {
    void params;
    void cb;
}

function local_same_file_animate_to_negative_F(): void {
    animateTo({
        duration: 200,
        onFinish: () => {
            console.info("done");
        },
    }, () => {
        console.info("tick");
    });
}

export { local_same_file_animate_to_negative_F };
