import { MqttClient } from '@ohos/mqtt';

export function mqtt_publish_payload_001_T(userInput: string): void {
    const client = new MqttClient({ url: 'mqtt://broker.example.test' });
    const publishOptions = {
        topic: 'safe/topic',
        payload: userInput,
        qos: 1
    };
    client.publish(publishOptions);
}
