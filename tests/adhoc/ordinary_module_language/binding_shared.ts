export let exportedSeed: string = "_";

export function writeExportedSeed(value: string): void {
    exportedSeed = value;
}

export const exportedBox = {
    seed: "_",
    other: "_",
};

export function writeExportedBox(value: string): void {
    exportedBox.seed = value;
}
