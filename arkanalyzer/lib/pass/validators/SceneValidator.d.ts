import { Scene } from '../../Scene';
import { SceneSummary } from './Validator';
import './Exprs';
import './Stmts';
import './Values';
/**
 * The SceneValidator class is responsible for validating a given scene by leveraging the ScenePassMgr.
 * It sets up a context for validation, executes the validation process, and retrieves the summary of the validation.
 *
 * The validate method initializes a new SceneSummary instance, associates it with the current scene context,
 * runs the validation process using the configured manager, and finally returns the generated summary.
 *
 * This class ensures that the validation logic is encapsulated and provides a clean interface for processing scenes.
 */
export declare class SceneValidator {
    private mgr;
    validate(scene: Scene): SceneSummary;
}
//# sourceMappingURL=SceneValidator.d.ts.map