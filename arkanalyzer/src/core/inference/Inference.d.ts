import { ArkBaseModel } from '../model/ArkBaseModel';
import { ArkFile, Language } from '../model/ArkFile';
import { Stmt } from '../base/Stmt';
import { Value } from '../base/Value';
export type ArkModel = ArkBaseModel | ArkFile | Stmt;
type ArkIR = ArkModel | Value;
/**
 * Interface defining the core inference operation
 */
export interface Inference {
    /**
     * Performs inference on a given model
     * @param model - The ArkIR model to perform inference on
     * @returns Inference result
     */
    doInfer(model: ArkIR): any;
}
/**
 * Interface defining a complete inference workflow with pre/post processing steps
 */
export interface InferenceFlow {
    /**
     * Preparation steps before performing inference
     * @param model - The ArkIR model to prepare for inference
     * @returns Preparation result
     */
    preInfer(model: ArkIR): any;
    /**
     * Main inference operation
     * @param model - The ArkIR model to perform inference on
     * @returns Inference result
     */
    infer(model: ArkIR): any;
    /**
     * Cleanup and processing after inference completes
     * @param model - The ArkIR model that was processed
     * @returns Post-processing result
     */
    postInfer(model: ArkIR): any;
}
export declare class InferenceManager {
    private static instance;
    private inferenceMap;
    private constructor();
    static getInstance(): InferenceManager;
    getInference(lang: Language): Inference;
    private changeToInferLanguage;
}
export {};
