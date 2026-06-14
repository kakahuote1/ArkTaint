class LocalMqttClient {
    publish(options: object): void {
    }
}

export function mqtt_local_publish_005_F(userInput: string): void {
    const client = new LocalMqttClient();
    client.publish({
        topic: "device/status",
        payload: userInput
    });
}
