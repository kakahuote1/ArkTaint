import VendorBus from "@vendor.bus";

function directLeaf001(): void {
}

function nestedLeaf001(): void {
}

export function opaque_external_callback_001_T(): void {
    VendorBus.register(directLeaf001);
}

export function opaque_external_callback_nested_002_T(): void {
    VendorBus.register(() => {
        VendorBus.register(nestedLeaf001);
    });
}
