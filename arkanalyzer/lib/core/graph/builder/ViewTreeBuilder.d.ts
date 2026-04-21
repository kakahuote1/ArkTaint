import { Constant } from '../../base/Constant';
import { Decorator } from '../../base/Decorator';
import { ArkInstanceInvokeExpr } from '../../base/Expr';
import { Local } from '../../base/Local';
import { ArkInstanceFieldRef } from '../../base/Ref';
import { Stmt } from '../../base/Stmt';
import { Type } from '../../base/Type';
import { ArkClass } from '../../model/ArkClass';
import { ArkField } from '../../model/ArkField';
import { ArkMethod } from '../../model/ArkMethod';
import { ClassSignature, MethodSignature } from '../../model/ArkSignature';
import { ViewTree, ViewTreeNode } from '../ViewTree';
declare class ViewTreeNodeImpl implements ViewTreeNode {
    name: string;
    stmts: Map<string, [Stmt, (MethodSignature | ArkInstanceFieldRef | Constant)[]]>;
    attributes: Map<string, [Stmt, (MethodSignature | ArkInstanceFieldRef | Constant)[]]>;
    stateValues: Set<ArkField>;
    parent: ViewTreeNode | null;
    children: ViewTreeNodeImpl[];
    classSignature?: MethodSignature | ClassSignature | undefined;
    signature?: MethodSignature | ClassSignature | undefined;
    stateValuesTransfer?: Map<ArkField, ArkMethod | ArkField> | undefined;
    builderParam?: ArkField | undefined;
    builder?: MethodSignature | undefined;
    private type;
    constructor(name: string);
    /**
     * Whether the node type is Builder.
     * @returns true: node is Builder, false others.
     */
    isBuilder(): boolean;
    /**
     * @internal
     */
    isBuilderParam(): boolean;
    /**
     * Whether the node type is custom component.
     * @returns true: node is custom component, false others.
     */
    isCustomComponent(): boolean;
    /**
     * walk node and node's children
     * @param selector Node selector function, return true skipping the follow-up nodes.
     * @returns
     *  - true: There are nodes that meet the selector.
     *  - false: does not exist.
     */
    walk(selector: (item: ViewTreeNode) => boolean, visitor?: Set<ViewTreeNode>): boolean;
    static createCustomComponent(): ViewTreeNodeImpl;
    static createBuilderNode(): ViewTreeNodeImpl;
    static createBuilderParamNode(): ViewTreeNodeImpl;
    static createBehaviorNode(): ViewTreeNodeImpl;
    changeBuilderParam2BuilderNode(builder: ArkMethod): void;
    hasBuilderParam(): boolean;
    clone(parent: ViewTreeNodeImpl, map?: Map<ViewTreeNodeImpl, ViewTreeNodeImpl>): ViewTreeNodeImpl;
    addStmt(local2Node: Map<Local, ViewTreeNodeImpl>, tree: ViewTreeImpl, stmt: Stmt): void;
    private parseAttributes;
    private getBindValues;
    parseStateValues(tree: ViewTreeImpl, stmt: Stmt): void;
}
declare class TreeNodeStack {
    protected root: ViewTreeNodeImpl | null;
    protected stack: ViewTreeNodeImpl[];
    constructor();
    /**
     * @internal
     */
    push(node: ViewTreeNodeImpl): void;
    /**
     * @internal
     */
    pop(): void;
    /**
     * @internal
     */
    top(): ViewTreeNodeImpl | null;
    /**
     * @internal
     */
    isEmpty(): boolean;
    /**
     * @internal
     */
    popAutomicComponent(name: string): void;
    /**
     * @internal
     */
    popComponentExpect(name: string): TreeNodeStack;
    private getParent;
    protected isContainer(name: string): boolean;
}
export declare class ViewTreeImpl extends TreeNodeStack implements ViewTree {
    private render;
    private buildViewStatus;
    private stateValues;
    private fieldTypes;
    /**
     * @internal
     */
    constructor(render: ArkMethod);
    /**
     * ViewTree root node.
     * @returns root node
     */
    getRoot(): ViewTreeNode | null;
    /**
     * Map of the component controlled by the state variable
     * @returns
     */
    getStateValues(): Map<ArkField, Set<ViewTreeNode>>;
    /**
     * @deprecated Use {@link getStateValues} instead.
     */
    isClassField(name: string): boolean;
    /**
     * @deprecated Use {@link getStateValues} instead.
     */
    getClassFieldType(name: string): Decorator | Type | undefined;
    /**
     * @internal
     */
    private buildViewTree;
    /**
     * @internal
     */
    private isInitialized;
    /**
     * @internal
     */
    addStateValue(field: ArkField, node: ViewTreeNode): void;
    /**
     * @internal
     */
    private isCreateFunc;
    private loadClasssFieldTypes;
    /**
     * @internal
     */
    getDeclaringArkClass(): ArkClass;
    /**
     * @internal
     */
    private findMethod;
    /**
     * @internal
     */
    private findMethodWithName;
    /**
     * @internal
     */
    private findClass;
    private findBuilderMethod;
    /**
     * @internal
     */
    private addBuilderNode;
    /**
     * @internal
     */
    private addCustomComponentNode;
    private cloneBuilderParamNode;
    /**
     * @internal
     */
    private addBuilderParamNode;
    /**
     * @internal
     */
    private addSystemComponentNode;
    private findMethodInvokeBuilderMethod;
    private parseFieldInObjectLiteral;
    private parseObjectLiteralExpr;
    private viewComponentCreationParser;
    private waterFlowCreationParser;
    private forEachCreationParser;
    private repeatCreationParser;
    private ifBranchCreationParser;
    private COMPONENT_CREATE_PARSERS;
    COMPONENT_BEHAVIOR_PARSERS: Map<string, (local2Node: Map<Local, ViewTreeNodeImpl>, stmt: Stmt, expr: ArkInstanceInvokeExpr) => ViewTreeNodeImpl | undefined>;
    private componentCreateParse;
    private parseStaticInvokeExpr;
    /**
     * $temp4.margin({ top: 20 });
     * @param viewTree
     * @param local2Node
     * @param expr
     */
    private parseInstanceInvokeExpr;
    private parsePtrInvokeExpr;
    /**
     * $temp3 = View.create($temp2);
     * $temp4 = View.pop();
     * $temp4.margin({ top: 20 });
     *
     * $temp2 = List.create();
     * $temp5 = $temp2.width('100%');
     * $temp6 = $temp5.height('100%');
     * $temp6.backgroundColor('#FFDCDCDC');
     * @param viewTree
     * @param local2Node
     * @param stmt
     * @returns
     */
    private parseAssignStmt;
    private parseInvokeStmt;
    private buildViewTreeFromCfg;
    /**
     * Parses the 'tabBar' behavior binding.
     * Only supports extracting the argument when it is of type CustomBuilder.
     * Other argument types (e.g. string, Resource, TabBarOptions, SubTabBarStyle, BottomTabBarStyle, ComponentContent) are not handled.
     *
     * Supported signatures:
     *   - tabBar(options: string | Resource | CustomBuilder | TabBarOptions)
     *   - tabBar(value: SubTabBarStyle | BottomTabBarStyle) // API 9+
     *   - tabBar(content: ComponentContent | SubTabBarStyle | BottomTabBarStyle | string | Resource | CustomBuilder | TabBarOptions) // API 18+
     */
    private tabBarComponentParser;
    /**
     * Parses the 'navDestination' behavior binding.
     * Supports extracting the 'builder' argument when it is of FunctionType.
     *
     * navDestination(builder: (name: string, param: unknown) => void)
     */
    private navDestinationComponentParser;
    /**
     * Parses the 'bindContextMenu' behavior binding for API 8 and API 12.
     * Only supports extracting the 'content' argument when it is of type CustomBuilder.
     * Other argument types (e.g. ResponseType, ContextMenuOptions) are not handled.
     *
     * Supported signatures:
     *   - bindContextMenu(content: CustomBuilder, responseType: ResponseType, options?: ContextMenuOptions): T   // API 8
     *   - bindContextMenu(isShown: boolean, content: CustomBuilder, options?: ContextMenuOptions): T             // API 12
     */
    private bindContextMenuComponentParser;
    /**
     * Parses the 'bindContentCover' behavior binding.
     * Only supports extracting the CustomBuilder argument from the second parameter.
     * Other ContentCoverOptions properties are not handled.
     *
     * bindContentCover(isShow: boolean, builder: CustomBuilder, options?: ContentCoverOptions): T
     */
    private bindContentCoverComponentParser;
    /**
     * Parses the 'bindPopup' behavior binding.
     * Only supports extracting the 'builder' field from CustomPopupOptions (custom popup content).
     * Other PopupOptions properties are not supported yet.
     *
     * bindPopup(show: boolean, popup: PopupOptions | CustomPopupOptions): T
     */
    private bindPopupComponentParser;
    private parseBehaviorComponent;
    private parseBuilderFieldNode;
}
export declare function buildViewTree(render: ArkMethod): ViewTree;
export {};
//# sourceMappingURL=ViewTreeBuilder.d.ts.map