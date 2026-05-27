import { createBuiltinModuleAsset, decoratorSurface } from "../../moduleAssetHelpers";

const stateDecorators = ["State"];
const propDecorators = ["Prop", "Link", "ObjectLink", "Local", "Param", "Once", "Event", "Trace"];
const linkDecorators = ["Link", "ObjectLink", "Local", "Trace"];
const provideDecorators = ["Provide", "Provider"];
const consumeDecorators = ["Consume", "Consumer"];
const eventDecorators = ["Event"];

const harmonyStateModuleAsset = createBuiltinModuleAsset({
    id: "harmony.state",
    description: "Built-in Harmony state/prop/link/provide-consume bridges.",
    semanticsFamily: "harmony-state-binding",
    role: "handoff",
    capability: "module.state-binding",
    surfaces: [
        ...[...new Set([
            ...stateDecorators,
            ...propDecorators,
            ...linkDecorators,
            ...provideDecorators,
            ...consumeDecorators,
            ...eventDecorators,
        ])].map(name => decoratorSurface(`harmony.state.decorator.${name}`, name)),
    ],
    payload: {
        stateDecorators,
        propDecorators,
        linkDecorators,
        provideDecorators,
        consumeDecorators,
        eventDecorators,
    },
});

export default harmonyStateModuleAsset;
