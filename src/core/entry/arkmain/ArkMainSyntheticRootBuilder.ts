import { Scene } from "../../../../arkanalyzer/lib/Scene";
import { ArkMethod } from "../../../../arkanalyzer/lib/core/model/ArkMethod";
import { ArkFile, Language } from "../../../../arkanalyzer/lib/core/model/ArkFile";
import { ArkClass } from "../../../../arkanalyzer/lib/core/model/ArkClass";
import { ArkBody } from "../../../../arkanalyzer/lib/core/model/ArkBody";
import { FileSignature, ClassSignature, MethodSignature } from "../../../../arkanalyzer/lib/core/model/ArkSignature";
import { ArkSignatureBuilder } from "../../../../arkanalyzer/lib/core/model/builder/ArkSignatureBuilder";
import { checkAndUpdateMethod } from "../../../../arkanalyzer/lib/core/model/builder/ArkMethodBuilder";
import { Cfg } from "../../../../arkanalyzer/lib/core/graph/Cfg";
import { BasicBlock } from "../../../../arkanalyzer/lib/core/graph/BasicBlock";
import { Local } from "../../../../arkanalyzer/lib/core/base/Local";
import { ClassType, Type } from "../../../../arkanalyzer/lib/core/base/Type";
import { ArkAssignStmt, ArkInvokeStmt, ArkReturnVoidStmt } from "../../../../arkanalyzer/lib/core/base/Stmt";
import { ArkInstanceInvokeExpr, ArkNewExpr, ArkStaticInvokeExpr } from "../../../../arkanalyzer/lib/core/base/Expr";
import { CONSTRUCTOR_NAME } from "../../../../arkanalyzer/lib/core/common/TSConst";

export interface ArkMainSyntheticRootDescriptor {
    fileName: string;
    className: string;
    methodName: string;
}

export interface ArkMainSyntheticRootBuildResult {
    method: ArkMethod;
    cleanup: () => void;
}

export class ArkMainSyntheticRootBuilder {
    private readonly scene: Scene;
    private tempLocalIndex: number = 0;
    private readonly classLocals = new Map<string, Local>();

    constructor(scene: Scene) {
        this.scene = scene;
    }

    public build(
        entryMethods: ArkMethod[],
        descriptor: ArkMainSyntheticRootDescriptor,
    ): ArkMainSyntheticRootBuildResult {
        this.tempLocalIndex = 0;
        this.classLocals.clear();
        const projectName = this.scene.getProjectName?.() || "@project";
        const syntheticFile = new ArkFile(Language.JAVASCRIPT);
        syntheticFile.setScene(this.scene);
        syntheticFile.setFileSignature(new FileSignature(projectName, descriptor.fileName));
        this.scene.setFile(syntheticFile);

        const syntheticClass = new ArkClass();
        syntheticClass.setDeclaringArkFile(syntheticFile);
        syntheticClass.setSignature(new ClassSignature(descriptor.className, syntheticFile.getFileSignature(), null));
        syntheticFile.addArkClass(syntheticClass);

        const syntheticMethod = new ArkMethod();
        syntheticMethod.setDeclaringArkClass(syntheticClass);
        syntheticMethod.setImplementationSignature(new MethodSignature(
            syntheticClass.getSignature(),
            ArkSignatureBuilder.buildMethodSubSignatureFromMethodName(descriptor.methodName),
        ));
        syntheticMethod.setLineCol((entryMethods[0]?.getLineCol?.() || 0) as any);
        syntheticMethod.setIsGeneratedFlag(true);
        checkAndUpdateMethod(syntheticMethod, syntheticClass);
        syntheticClass.addMethod(syntheticMethod);

        const { cfg, locals } = this.createFlatCfg(entryMethods, syntheticMethod);
        const body = new ArkBody(new Set(locals), cfg);
        syntheticMethod.setBody(body);
        this.bindCfgToStmts(cfg);
        this.scene.addToMethodsMap(syntheticMethod);

        return {
            method: syntheticMethod,
            cleanup: () => {
                try {
                    this.scene.removeMethod(syntheticMethod);
                } catch {
                    // Ignore cleanup failures for transient synthetic methods.
                }
                try {
                    this.scene.removeFile(syntheticFile);
                } catch {
                    // Ignore cleanup failures for transient synthetic files.
                }
            },
        };
    }

    private createFlatCfg(entryMethods: ArkMethod[], syntheticMethod: ArkMethod): {
        cfg: Cfg;
        locals: Local[];
    } {
        const cfg = new Cfg();
        cfg.setDeclaringMethod(syntheticMethod);
        const block = new BasicBlock();
        const locals: Local[] = [];

        this.addStaticInit(block);
        this.addClassInit(entryMethods, block, locals);

        for (const method of entryMethods) {
            const paramLocals = this.addParamInit(method, block, locals);
            const baseLocal = this.resolveBaseLocal(method);
            const invokeExpr = baseLocal
                ? new ArkInstanceInvokeExpr(baseLocal, method.getSignature(), paramLocals)
                : new ArkStaticInvokeExpr(method.getSignature(), paramLocals);
            block.addStmt(new ArkInvokeStmt(invokeExpr));
        }

        block.addStmt(new ArkReturnVoidStmt());
        cfg.addBlock(block);
        const startStmt = block.getHead();
        if (startStmt) {
            cfg.setStartingStmt(startStmt);
        }

        return {
            cfg,
            locals: this.dedupeLocals(locals),
        };
    }

    private addStaticInit(block: BasicBlock): void {
        for (const method of this.scene.getStaticInitMethods()) {
            block.addStmt(new ArkInvokeStmt(new ArkStaticInvokeExpr(method.getSignature(), [])));
        }
    }

    private addClassInit(entryMethods: ArkMethod[], block: BasicBlock, locals: Local[]): void {
        for (const method of entryMethods) {
            if (!this.needsReceiver(method)) continue;
            const declaringClass = method.getDeclaringArkClass();
            const classSignature = declaringClass.getSignature().toString();
            if (this.classLocals.has(classSignature)) continue;

            const instanceLocal = new Local(`%${this.tempLocalIndex++}`, new ClassType(declaringClass.getSignature()));
            this.classLocals.set(classSignature, instanceLocal);
            locals.push(instanceLocal);

            const newStmt = new ArkAssignStmt(instanceLocal, new ArkNewExpr(instanceLocal.getType() as ClassType));
            instanceLocal.setDeclaringStmt(newStmt);
            block.addStmt(newStmt);

            const constructorMethod = declaringClass.getMethodWithName(CONSTRUCTOR_NAME);
            if (constructorMethod) {
                block.addStmt(new ArkInvokeStmt(
                    new ArkInstanceInvokeExpr(instanceLocal, constructorMethod.getSignature(), []),
                ));
            }
        }
    }

    private addParamInit(method: ArkMethod, block: BasicBlock, locals: Local[]): Local[] {
        const paramLocals: Local[] = [];
        const parameters = method.getParameters?.() || [];
        for (let index = 0; index < parameters.length; index++) {
            const parameter = parameters[index];
            const paramType = this.resolveParameterType(method, index, parameter?.getType?.());
            const paramLocal = new Local(`%${this.tempLocalIndex++}`, paramType);
            paramLocals.push(paramLocal);
            locals.push(paramLocal);

            if (paramType instanceof ClassType) {
                const assignStmt = new ArkAssignStmt(paramLocal, new ArkNewExpr(paramType));
                paramLocal.setDeclaringStmt(assignStmt);
                block.addStmt(assignStmt);
            }
        }
        return paramLocals;
    }

    private resolveParameterType(method: ArkMethod, paramIndex: number, initialType?: Type): Type | undefined {
        if (initialType) return initialType;
        let currentClass = method.getDeclaringArkClass()?.getSuperClass?.();
        while (currentClass) {
            const superMethod = currentClass.getMethodWithName?.(method.getName?.());
            const candidateType = superMethod?.getParameters?.()?.[paramIndex]?.getType?.();
            if (candidateType) {
                return candidateType;
            }
            currentClass = currentClass.getSuperClass?.();
        }
        return initialType;
    }

    private resolveBaseLocal(method: ArkMethod): Local | null {
        if (!this.needsReceiver(method)) return null;
        const classSignature = method.getDeclaringArkClass().getSignature().toString();
        return this.classLocals.get(classSignature) || null;
    }

    private needsReceiver(method: ArkMethod): boolean {
        return !method.isStatic() && !method.getDeclaringArkClass().isDefaultArkClass();
    }

    private dedupeLocals(locals: Local[]): Local[] {
        const dedup = new Map<string, Local>();
        for (const local of locals) {
            if (!local) continue;
            if (!dedup.has(local.getName())) {
                dedup.set(local.getName(), local);
            }
        }
        return [...dedup.values()];
    }

    private bindCfgToStmts(cfg: Cfg): void {
        for (const block of cfg.getBlocks()) {
            for (const stmt of block.getStmts()) {
                stmt.setCfg(cfg);
            }
        }
    }
}
