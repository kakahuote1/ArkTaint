import { MqttClient } from "@ohos/mqtt";

export function mqtt_publish_payload_002_T(userInput: string): void {
    const client = new MqttClient({ url: "tcp://broker.example.com:1883" });
    const publishOption = {
        topic: "device/status",
        payload: userInput,
        qos: 1
    };
    client.publish(publishOption);
}
