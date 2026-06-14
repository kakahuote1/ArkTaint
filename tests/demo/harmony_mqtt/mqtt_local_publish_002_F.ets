class MqttClient {
    publish(_options: any): void {}
}

export function mqtt_local_publish_002_F(userInput: string): void {
    const client = new MqttClient();
    client.publish({ topic: 'safe/topic', payload: userInput });
}
