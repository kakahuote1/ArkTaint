export const localGeoLocationManager = {
    getLastLocation(): string {
        return "safe-location";
    },
};

export const localDataPreferences = {
    getSync(_key: string): string {
        return "safe-preference";
    },
};

export const localHttp = {
    request(_url: string): string {
        return "safe-response";
    },
};

