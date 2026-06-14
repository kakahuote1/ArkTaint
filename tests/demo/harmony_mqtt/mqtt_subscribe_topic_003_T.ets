import { MqttClient } from "@ohos/mqtt";

export function mqtt_subscribe_topic_003_T(userInput: string): void {
    const client = new MqttClient({ url: "tcp://broker.example.com:1883" });
    const subscribeOption = {
        topic: userInput,
        qos: 1
    };
    client.subscribe(subscribeOption);
}
