export interface ArkUiChainKey {
    componentName: string;
    attributeOwner: string;
    eventName: string;
    callbackArgCount: number;
    sourceFile: string;
}

export function arkUiChainKeyString(key: ArkUiChainKey): string {
    return JSON.stringify({
        componentName: key.componentName,
        attributeOwner: key.attributeOwner,
        eventName: key.eventName,
        callbackArgCount: key.callbackArgCount,
    });
}

