import { MqttClient } from "@ohos/mqtt";

export function mqtt_connect_options_001_T(userInput: string): void {
    const client = new MqttClient({ url: "tcp://broker.example.com:1883" });
    const options = {
        userName: userInput,
        password: "safe"
    };
    client.connect(options);
}
