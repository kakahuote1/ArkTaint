"use strict";
/*
 * Copyright (c) 2024-2025 Huawei Device Co., Ltd.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SceneSummary = exports.FileValidator = exports.FileSummary = exports.ClassValidator = exports.ClassSummary = exports.MethodValidator = exports.MethodSummary = exports.ArkValidatorRegistry = exports.ValueValidator = exports.StmtValidator = exports.SummaryMsg = void 0;
const Pass_1 = require("../Pass");
const Dispatcher_1 = require("../Dispatcher");
const logger_1 = __importStar(require("../../utils/logger"));
const logger = logger_1.default.getLogger(logger_1.LOG_MODULE_TYPE.ARKANALYZER, 'Validator');
/**
 * Represents a summary message with an associated level and content.
 * The SummaryMsg class is used to encapsulate messages that have a specific severity or importance level.
 * It provides a way to associate a textual message with a defined level, making it suitable for logging, notifications, or summaries.
 * The constructor initializes the message and its level, ensuring both are explicitly defined at creation.
 */
class SummaryMsg {
    constructor(level, msg) {
        this.level = level;
        this.msg = msg;
    }
}
exports.SummaryMsg = SummaryMsg;
/**
 * Abstract class representing a statement validator.
 * Provides a mechanism to validate statements of a specific type within a given context.
 * Implementations must define the `validate` method to perform custom validation logic.
 */
class StmtValidator {
    run(s, ctx, mtd) {
        let submit = (msg) => {
            let summary = MethodSummary.getOrNew(ctx, mtd);
            summary.submitStmt(s, msg);
        };
        this.validate(s, {
            info: (msg) => submit(new SummaryMsg(0 /* SummaryLevel.info */, msg)),
            warn: (msg) => submit(new SummaryMsg(1 /* SummaryLevel.warn */, msg)),
            error: (msg) => submit(new SummaryMsg(2 /* SummaryLevel.error */, msg)),
        });
    }
    static register(init) {
        ArkValidatorRegistry.stmt(init);
    }
}
exports.StmtValidator = StmtValidator;
/**
 * Abstract class representing a validator for values of a specific type.
 * Provides a mechanism to validate values and report the results through a summary reporter.
 * The validation logic is defined by implementing the `validate` method in derived classes.
 */
class ValueValidator {
    run(s, ctx, mtd) {
        let submit = (msg) => {
            let summary = MethodSummary.getOrNew(ctx, mtd);
            summary.submitValue(s, msg);
        };
        this.validate(s, {
            info: (msg) => submit(new SummaryMsg(0 /* SummaryLevel.info */, msg)),
            warn: (msg) => submit(new SummaryMsg(1 /* SummaryLevel.warn */, msg)),
            error: (msg) => submit(new SummaryMsg(2 /* SummaryLevel.error */, msg)),
        });
    }
    static register(init) {
        ArkValidatorRegistry.value(init);
    }
}
exports.ValueValidator = ValueValidator;
/**
 * The ArkValidatorRegistry class is responsible for managing and registering statement and value initializers
 * used in validation processes. It extends the Dispatcher class and provides mechanisms to dynamically
 * register and invalidate dispatch configurations.
 */
class ArkValidatorRegistry extends Dispatcher_1.Dispatcher {
    constructor(ctx) {
        super(ctx, ArkValidatorRegistry.getDispatch());
        this.fallAction = 0 /* FallAction.Continue */;
    }
    static getDispatch() {
        if (ArkValidatorRegistry.dispatchHolder) {
            return ArkValidatorRegistry.dispatchHolder;
        }
        ArkValidatorRegistry.dispatchHolder = new Dispatcher_1.Dispatch(this.stmtsHolder, this.valuesHolder);
        return ArkValidatorRegistry.dispatchHolder;
    }
    static stmt(init) {
        this.stmtsHolder.push(init);
        // invalidate holder
        ArkValidatorRegistry.dispatchHolder = undefined;
    }
    static value(init) {
        this.valuesHolder.push(init);
        // invalidate holder
        ArkValidatorRegistry.dispatchHolder = undefined;
    }
}
exports.ArkValidatorRegistry = ArkValidatorRegistry;
ArkValidatorRegistry.stmtsHolder = [];
ArkValidatorRegistry.valuesHolder = [];
/**
 * Represents a summary of a method, capturing various messages and associations with values and statements.
 * This class provides methods to submit messages and associate them with specific values or statements.
 * It also supports retrieving or creating a method summary within a given context.
 */
class MethodSummary {
    constructor() {
        this.name = 'method summary';
        this.values = new Map();
        this.stmts = new Map();
        this.msgList = [];
    }
    submit(msg) {
        this.msgList.push(msg);
    }
    submitValue(value, msg) {
        if (!this.values.get(value)) {
            this.values.set(value, []);
        }
        this.values.get(value).push(msg);
    }
    submitStmt(stmt, msg) {
        if (this.stmts.get(stmt) === undefined) {
            this.stmts.set(stmt, []);
        }
        logger.info(`submit ${JSON.stringify(msg)}`);
        this.stmts.get(stmt).push(msg);
    }
    /**
     * Retrieves an existing MethodSummary from the context or creates a new one if it does not exist.
     *
     * @param ctx The method context in which the MethodSummary is stored or will be created.
     * @param mtd The ArkMethod for which the MethodSummary is being retrieved or created.
     * @return The existing or newly created MethodSummary associated with the provided context and method.
     */
    static getOrNew(ctx, mtd) {
        if (ctx.get(MethodSummary)) {
            return ctx.get(MethodSummary);
        }
        let cls = ClassSummary.getOrNew(ctx.upper, mtd.getDeclaringArkClass());
        if (!cls.methods.get(mtd)) {
            cls.methods.set(mtd, new MethodSummary());
        }
        let summary = cls.methods.get(mtd);
        ctx.set(MethodSummary, summary);
        return summary;
    }
}
exports.MethodSummary = MethodSummary;
class MethodValidator extends Pass_1.MethodPass {
    run(mtd, ctx) {
        let submit = (msg) => {
            let summary = MethodSummary.getOrNew(ctx, mtd);
            summary.submit(msg);
        };
        this.validate(mtd, {
            info: (msg) => submit(new SummaryMsg(0 /* SummaryLevel.info */, msg)),
            warn: (msg) => submit(new SummaryMsg(1 /* SummaryLevel.warn */, msg)),
            error: (msg) => submit(new SummaryMsg(2 /* SummaryLevel.error */, msg)),
        });
    }
}
exports.MethodValidator = MethodValidator;
/**
 * Represents a summary of a class, containing its name, associated methods, and messages.
 * Provides functionality to submit messages and retrieve or create a ClassSummary instance.
 * The class maintains a collection of method summaries and tracks messages related to the class.
 * It is designed to be used in the context of a larger system that processes class information.
 */
class ClassSummary {
    constructor() {
        this.name = 'class summary';
        this.methods = new Map();
        this.msgList = [];
    }
    submit(msg) {
        this.msgList.push(msg);
    }
    /**
     * Retrieves an existing ClassSummary instance from the given context or creates a new one if it does not exist.
     * If the ClassSummary is not found in the context, it attempts to retrieve or create a FileSummary for the declaring file of the class.
     * Ensures that the ClassSummary is associated with the provided class and context before returning it.
     *
     * @param ctx The context in which to search for or store the ClassSummary instance.
     * @param cls The class for which the ClassSummary is being retrieved or created.
     * @return The existing or newly created ClassSummary instance associated with the provided class and context.
     */
    static getOrNew(ctx, cls) {
        if (ctx.get(ClassSummary)) {
            return ctx.get(ClassSummary);
        }
        let file = FileSummary.getOrNew(ctx.upper, cls.getDeclaringArkFile());
        if (!file.classes.get(cls)) {
            file.classes.set(cls, new ClassSummary());
        }
        let summary = file.classes.get(cls);
        ctx.set(ClassSummary, summary);
        return summary;
    }
}
exports.ClassSummary = ClassSummary;
class ClassValidator extends Pass_1.ClassPass {
    run(cls, ctx) {
        let submit = (msg) => {
            let summary = ClassSummary.getOrNew(ctx, cls);
            summary.submit(msg);
        };
        this.validate(cls, {
            info: (msg) => submit(new SummaryMsg(0 /* SummaryLevel.info */, msg)),
            warn: (msg) => submit(new SummaryMsg(1 /* SummaryLevel.warn */, msg)),
            error: (msg) => submit(new SummaryMsg(2 /* SummaryLevel.error */, msg)),
        });
    }
}
exports.ClassValidator = ClassValidator;
/**
 * Represents a summary of a file containing information about classes and messages.
 * Provides methods to manage and retrieve file summaries within a given context.
 * The class maintains a collection of messages and a mapping of classes to their summaries.
 * It supports operations to submit new messages and retrieve or create summaries for files.
 */
class FileSummary {
    constructor() {
        this.name = 'file summary';
        this.classes = new Map();
        this.msgList = [];
    }
    submit(msg) {
        this.msgList.push(msg);
    }
    /**
     * Retrieves an existing FileSummary instance from the given context or creates a new one if it does not exist.
     *
     * @param ctx The context object that holds the FileSummary instance. It is used to check if a FileSummary already exists.
     * @param file The ArkFile object for which the FileSummary is being retrieved or created.
     * @return The existing or newly created FileSummary instance associated with the provided file.
     */
    static getOrNew(ctx, file) {
        if (ctx.get(FileSummary)) {
            return ctx.get(FileSummary);
        }
        let validate = ctx.upper.get(SceneSummary);
        if (!validate.files.get(file)) {
            validate.files.set(file, new FileSummary());
        }
        let summary = validate.files.get(file);
        ctx.set(FileSummary, summary);
        return summary;
    }
}
exports.FileSummary = FileSummary;
class FileValidator extends Pass_1.FilePass {
    run(file, ctx) {
        let submit = (msg) => {
            let summary = FileSummary.getOrNew(ctx, file);
            summary.submit(msg);
        };
        this.validate(file, {
            info: (msg) => submit(new SummaryMsg(0 /* SummaryLevel.info */, msg)),
            warn: (msg) => submit(new SummaryMsg(1 /* SummaryLevel.warn */, msg)),
            error: (msg) => submit(new SummaryMsg(2 /* SummaryLevel.error */, msg)),
        });
    }
}
exports.FileValidator = FileValidator;
/**
 * Represents a summary of a scene, containing metadata and associated file summaries.
 * The name property provides a default identifier for the scene summary.
 * The files property maintains a mapping of ArkFile instances to their corresponding FileSummary objects.
 * This class is used to encapsulate and manage information about a scene and its related files.
 */
class SceneSummary {
    constructor() {
        this.name = 'validate summary';
        this.files = new Map();
    }
    /**
     * Checks if the current instance is in an acceptable state.
     * @return {boolean} - Returns true if the files collection is empty, indicating an acceptable state; otherwise, false.
     */
    isOk() {
        return this.files.size === 0;
    }
    /**
     * Dumps the scene summary and details to the log based on the specified level.
     * @param {SummaryLevel} [level=SummaryLevel.info] - The minimum level of messages to include in the log. Defaults to SummaryLevel.info.
     * @return {void}
     */
    dump2log(level = 0 /* SummaryLevel.info */) {
        logger.info(`scene summary`);
        for (const [file, fs] of this.files) {
            logger.info(`file ${file.getName()} msg ${JSON.stringify(fs.msgList.filter((v) => v.level >= level))}`);
            for (const [cls, cs] of fs.classes) {
                this.classDump(cls, cs, level);
            }
        }
    }
    classDump(cls, cs, level = 0 /* SummaryLevel.info */) {
        logger.info(`class ${cls.getName()} msg ${JSON.stringify(cs.msgList.filter((v) => v.level >= level))}`);
        for (const [mtd, ms] of cs.methods) {
            logger.info(`method ${mtd.getName()} msg ${JSON.stringify(ms.msgList.filter((v) => v.level >= level))}`);
            for (let [s, ss] of ms.stmts) {
                logger.info(`stmt ${s} ${JSON.stringify(ss.filter((v) => v.level >= level))}`);
            }
            for (let [v, vs] of ms.values) {
                logger.info(`value ${v} ${JSON.stringify(vs.filter((v) => v.level >= level))}`);
            }
        }
    }
}
exports.SceneSummary = SceneSummary;
