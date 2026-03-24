import { Command } from 'commander';
import { Scene } from '../../Scene';
import { ArkFile } from '../../core/model/ArkFile';
export declare function buildSceneFromSingleFile(filename: string, verbose?: boolean): Scene;
export declare function buildSceneFromProjectDir(inputDir: string, verbose?: boolean): Scene;
export declare function serializeArkFile(arkFile: ArkFile, output?: string): void;
export declare function serializeScene(scene: Scene, outDir: string, verbose?: boolean): void;
export declare const program: Command;
//# sourceMappingURL=serializeArkIR.d.ts.map