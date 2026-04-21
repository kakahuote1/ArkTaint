import { Local } from '../base/Local';
import { Cfg } from '../graph/Cfg';
import { AliasType } from '../base/Type';
import { Trap } from '../base/Trap';
import { Value } from '../base/Value';
import { ArkAliasTypeDefineStmt } from '../base/Stmt';
export declare class ArkBody {
    private locals;
    private usedGlobals?;
    private cfg;
    private aliasTypeMap?;
    private traps?;
    constructor(locals: Set<Local>, cfg: Cfg, aliasTypeMap?: Map<string, [AliasType, ArkAliasTypeDefineStmt]>, traps?: Trap[]);
    getLocals(): Map<string, Local>;
    setLocals(locals: Set<Local>): void;
    addLocal(name: string, local: Local): void;
    getUsedGlobals(): Map<string, Value> | undefined;
    setUsedGlobals(globals: Map<string, Value>): void;
    getCfg(): Cfg;
    setCfg(cfg: Cfg): void;
    getAliasTypeMap(): Map<string, [AliasType, ArkAliasTypeDefineStmt]> | undefined;
    getAliasTypeByName(name: string): AliasType | null;
    getTraps(): Trap[] | undefined;
    getExportLocalByName(name: string): Local | null;
}
//# sourceMappingURL=ArkBody.d.ts.map