import { MqttClient } from "@ohos/mqtt";

export function mqtt_subscribe_many_004_T(userInput: string): void {
    const client = new MqttClient({ url: "tcp://broker.example.com:1883" });
    const subscribeOptions = [
        {
            topic: userInput,
            qos: 1
        }
    ];
    client.subscribeMany(subscribeOptions);
}
