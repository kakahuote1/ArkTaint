import geoLocationManager from '@ohos.geoLocationManager';
import dataPreferences from '@ohos.data.preferences';
import http from '@ohos.net.http';
import { localDataPreferences, localGeoLocationManager, localHttp } from './local_helpers';

function Sink(_value: unknown): void {}

export function unknown_sdk_geo_getLastLocation_001_T(): void {
    const info = JSON.stringify(geoLocationManager.getLastLocation());
    Sink(info);
}

export function unknown_sdk_geo_getLastLocation_002_F(): void {
    const info = JSON.stringify(localGeoLocationManager.getLastLocation());
    Sink(info);
}

export function unknown_sdk_preferences_getSync_003_T(): void {
    const value = dataPreferences.getSync('token');
    Sink(value);
}

export function unknown_sdk_preferences_getSync_004_F(): void {
    const value = localDataPreferences.getSync('token');
    Sink(value);
}

export function unknown_sdk_http_request_005_T(): void {
    const response = http.request('https://example.test');
    Sink(response);
}

export function unknown_sdk_http_request_006_F(): void {
    const response = localHttp.request('https://example.test');
    Sink(response);
}

