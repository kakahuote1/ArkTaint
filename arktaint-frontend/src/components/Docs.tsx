type DocCodeBlock = {
  language: string;
  content: string;
};

type DocContentBlock = {
  title: string;
  body?: string[];
  steps?: string[];
  bullets?: string[];
  code?: DocCodeBlock;
};

type DocFaqItem = {
  q: string;
  a: string;
};

type DocSection = {
  id: string;
  title: string;
  summary: string;
  blocks?: DocContentBlock[];
  faq?: DocFaqItem[];
};

const docSections: DocSection[] = [
  {
    id: 'product-overview',
    title: '产品简介',
    summary: '',
    blocks: [
      {
        title: 'ArkTaint 是什么',
        body: [
          'ArkTaint 是一套面向真实项目场景的静态污点分析工作台，用于统一承载项目接入、分析策略配置、建模增强、任务执行与结果查看等关键环节。',
          '产品通过图形化页面整合原本分散的分析入口与运行信息，帮助使用者在同一工作台内完成从任务准备到结果产出的完整分析流程，提升批量分析任务的组织效率与执行一致性。',
        ],
      },
      {
        title: '开始使用前，建议您先了解',
        body: [
          '建议优先完成“全局能力配置”，确认模型接入方式可用后，再上传项目压缩包并配置本次任务的分析范围与执行策略。若默认能力已满足需求，可直接执行标准分析；如需增强识别效果，再按需补充规则文件、模块建模文件或扩展插件。',
        ],
      },
    ],
  },
  {
    id: 'workflow',
    title: '完整使用流程',
    summary: '按实际操作顺序说明如何完成一次可运行的分析任务。',
    blocks: [
      {
        title: '第 1 步：完成全局能力配置',
        body: [
          '进入“全局能力配置”页后，优先完成 LLM 辅助建模配置。该能力用于接入大模型，对复杂项目中的 API 语义和业务行为进行辅助理解。',
          '如果您希望直接完成接入，建议优先选择“直接填写 API 配置”；如果团队已经维护了统一配置文件，可以直接选择“使用已有配置文件”。',
          '这一部分的核心目标是让系统具备可用的模型访问能力。只要模型接入信息不完整，LLM 辅助建模状态就不会变为“已完成”，后续分析也无法按预期使用这部分能力。',
        ],
        bullets: [
          '接口地址：用于指定模型服务的请求入口，例如兼容 OpenAI 接口的 `https://.../v1`。如果地址填写错误，系统即使拿到 API Key 也无法正常发起请求。',
          'API Key：用于模型服务的身份校验。它决定系统是否有权限访问您填写的接口地址。该项通常由模型服务平台提供，前端会以密码形式展示。',
          '模型：用于指定实际调用的模型名称。这里填写的值需要与您接入的平台真实支持的模型名一致，否则请求可能成功发出，但模型侧会返回“模型不存在”或类似错误。',
          '选择“直接填写 API 配置”时，接口地址、API Key 和模型三项都属于必填项，只有这三项都补齐后，LLM 辅助建模状态才会显示为“已完成”。',
          'API Key Header：用于指定鉴权请求头名称，默认通常是 `Authorization`。只有当您的模型网关使用了自定义头名时，才需要改这里。',
          'API Key Prefix：用于指定 API Key 写入请求头时的前缀，默认通常是 `Bearer `。如果您的服务要求直接传裸 Key，或者使用其他前缀格式，再按服务要求修改。',
          '连接超时（ms）：控制“建立连接”这一步最多等待多久。它主要影响网络不可达、目标地址响应很慢这类场景。',
          '请求超时（ms）：控制单次模型请求从发出到等待返回的总时长上限。模型响应较慢、返回内容较大时，这个参数比连接超时更关键。',
          '最大尝试次数：控制单次调用在失败后最多还能重试多少次。适合网络偶发抖动或服务偶发不稳定的情况。',
          '最大失败次数：用于限制可接受的失败上限。超过这个范围后，系统会更倾向于直接判定当前调用不可继续，而不是无限重试。',
          '修复尝试次数：用于控制模型输出不符合预期格式时的修复重试次数。它更偏向“结果修复”，不是单纯的网络重发。',
          '最小调用间隔（ms）：用于限制相邻两次模型调用之间的最短间隔，适合对接有限流要求的服务，避免请求打得过快。',
          '自定义 Headers：用于补充额外请求头，例如某些网关要求的租户标识、环境标识或自定义认证头。填写格式是一行一个 `Header-Name: value`。',
          '如果您选择“使用已有配置文件”，系统会直接读取您提交的 JSON 配置文件内容，并使用文件中的模型接入信息；此时页面不再要求逐项填写接口地址、API Key 和模型。',
        ],
      },
      {
        title: '第 2 步：上传项目压缩包',
        body: [
          '进入“任务配置”页后，先上传项目压缩包。系统当前只支持 zip 压缩包。',
          '上传完成后，系统会自动解压并识别其中的项目目录，识别结果会显示在“识别到的项目”中。您可以直接使用系统识别结果，也可以按需调整分析范围。',
          '这一页除了项目接入本身，还关系到“本次到底分析哪些项目、结果输出到哪里”。因此建议在上传完成后顺手确认识别结果和输出目录，而不是直接进入下一步。',
        ],
        bullets: [
          '识别到的项目：表示系统从压缩包中成功识别出的可分析项目目录。后续批量分析会以这里的项目列表作为输入范围。',
          '结果输出目录：用于保存分析产物、日志和最终报告。如果不提前确认输出位置，后续虽然可以运行，但用户查找产物会比较分散。',
          '项目压缩包建议直接按“多个项目目录并列”组织。这样系统识别更稳定，也更容易在页面中核对本次任务的真实范围。',
        ],
      },
      {
        title: '第 3 步：配置执行策略',
        body: [
          '执行策略决定本次任务的分析强度、输出结果粒度以及批量运行行为。',
          '如果您不确定如何选择，建议先使用“标准分析 + 简要结果 + 默认上下文层数”。这是最稳妥的默认组合。',
          '这一页的参数可以理解为“本次任务如何跑”。它们不会改变项目内容本身，但会直接影响分析时长、结果详细程度以及批量任务的执行节奏。',
        ],
        bullets: [
          '分析深度：用于控制整体分析强度。快速筛查适合先做一轮粗粒度风险发现；标准分析适合大多数日常任务；深度复核更适合重点项目、重点版本或需要更充分排查的场景。深度越高，通常耗时也会更长。',
          '报告模式：用于控制结果输出的详细程度。简要结果更适合快速浏览和批量筛查；完整结果会保留更充分的细节，更适合人工复核、归档和进一步研判。',
          '上下文敏感层数（k）：用于控制上下文敏感分析的层数。这个值越大，系统区分不同调用上下文的能力通常越强，但分析成本也会随之上升。当前未填写时采用系统默认值 `1`，大多数常规任务保持默认即可。',
          '单个项目最长等待时间（秒）：用于限制单个项目在批量任务中的最大执行时长。当前未填写时采用系统默认策略，默认值为 `480` 秒。超过这个时间后，系统会按超时场景处理当前项目，避免单个项目长期占住整个批次。',
          '启用增量分析：用于复用已有分析结果，适合同一批项目的持续回归、重复验证或多轮迭代分析。只有在前一次分析结果可复用时，这个选项的价值才会更明显。',
          '跳过已分析项目：用于在批量复跑时自动跳过已经有结果的项目。它更适合“同一输出目录下反复执行”的场景，可以减少重复计算。',
          '发现首个风险后停止：用于快速判断目标项目中是否已经存在有效风险路径。一旦命中首个风险，系统会提前停止后续深挖，因此它适合快速确认，不适合完整排查或结果留档。',
        ],
      },
      {
        title: '第 4 步：按需补充建模增强',
        body: [
          '如果默认能力已经足够，您可以跳过这一部分；如果项目业务语义较重，建议补充规则文件、模块建模文件或扩展插件。',
          '这一部分的作用不是让每个项目都必须配置，而是为复杂项目提供更准确的业务理解能力。',
        ],
        bullets: [
          '规则文件：用于补充项目专属规则，帮助系统更准确理解哪些调用应被视为关键 source、sink 或特殊传播点。它更适合业务规则明确、默认能力难以覆盖的项目。',
          '模块建模文件：用于描述复杂模块中的传播语义和结构关系。对于封装层较深、跨模块传递较多的项目，这类文件能帮助系统更准确还原调用链和语义关系。',
          '扩展插件：用于按需接入额外分析能力。您可以单独为当前项目添加插件，也可以选择继承全局默认插件。全局插件适合团队通用能力，项目插件适合某个具体任务的临时增强。',
          '如果当前项目不需要额外增强，可以完全不配置这一部分。',
        ],
      },
      {
        title: '第 5 步：确认启动',
        body: [
          '在“确认启动”中，系统会汇总本次任务的分析范围、执行策略、全局能力和建模增强状态。',
          '确认无误后，点击“准备分析”，进入分析流程页。',
        ],
      },
      {
        title: '第 6 步：启动并查看结果',
        body: [
          '在分析流程页点击“开始分析”后，系统才会真正发起任务执行。',
          '执行过程中，您可以查看运行状态、运行输出、产物列表和结果预览。分析完成后，系统会输出面向用户的报告产物，结果预览会优先读取这些报告内容。',
        ],
      },
    ],
  },
  {
    id: 'formats',
    title: '文件格式要求',
    summary: '明确系统当前支持的上传格式、文件类型和用户需要满足的基本结构要求，帮助您一次准备正确。',
    blocks: [
      {
        title: '项目压缩包格式',
        body: [
          '当前工作台中的项目上传入口只支持 zip 压缩包。上传完成后，系统会自动解压并扫描其中的子目录，将识别到的项目列在“识别到的项目”区域。',
          '如果一个压缩包中包含多个项目，系统会把它们当作同一批次任务中的多个分析对象处理。',
        ],
        bullets: [
          '必须是 zip 格式。',
          '建议压缩包解压后直接得到项目目录集合。',
          '不要在最外层再额外包裹多层无关目录。',
          '如果系统未识别出项目，优先检查压缩包解压后的目录结构是否清晰。',
        ],
        code: {
          language: 'text',
          content: `projects.zip\n├─ app-one/\n│  ├─ src/\n│  └─ ...\n├─ app-two/\n│  ├─ src/\n│  └─ ...`,
        },
      },
      {
        title: '插件包格式',
        body: [
          '插件上传入口同样只支持 zip。上传后系统会自动解压，并将解压后的目录作为插件目录使用。',
          '插件既可以配置为全局默认插件，也可以配置为当前项目的扩展插件。',
        ],
        bullets: [
          '必须是 zip 格式。',
          '建议一个 zip 对应一个插件目录。',
          '尽量不要把多个无关插件混在同一个压缩包中。',
        ],
        code: {
          language: 'text',
          content: `plugin-bundle.zip\n└─ my-plugin/\n   ├─ plugin.json\n   ├─ rules/\n   └─ ...`,
        },
      },
      {
        title: '规则文件与模块建模文件',
        body: [
          '当前项目增强配置中的“规则文件”和“模块建模文件”均通过 JSON 文件方式接入。',
          '如果您没有这类文件，可以先不配置；只有在项目业务语义较复杂、默认能力不足时，才建议补充。',
        ],
        bullets: [
          '规则文件选择 JSON 文件。',
          '模块建模文件选择 JSON 文件。',
          '建议统一使用 UTF-8 编码。',
        ],
      },
      {
        title: 'LLM 配置文件格式',
        body: [
          '当您选择“使用已有配置文件”时，系统会直接读取用户提交的 LLM 配置文件信息。',
          '该文件建议使用 JSON 格式，并包含可直接用于模型接入的完整字段。',
        ],
        bullets: [
          '建议使用 UTF-8 编码。',
          '建议包含 activeProfile、profiles、provider、baseUrl 或 endpoint、model、apiKeyFile 等信息。',
        ],
      },
    ],
  },
  {
    id: 'templates',
    title: '模板示例',
    summary: '提供与当前产品能力一致的最小示例，帮助用户理解应该准备什么样的文件，而不是从零猜格式。',
    blocks: [
      {
        title: 'rules 模板示例',
        body: [
          '当前项目中的 rules 文件不是旧版的“name / rules / type”结构，而是统一使用规则资产格式。',
          '一个可用的 rules 文件至少应围绕“surfaces”“bindings”“effectTemplates”三部分组织；其中 surfaces 描述命中的程序面，bindings 描述该程序面的安全角色，effectTemplates 描述命中后产生的 source、sink 或 transfer 效果。',
          '下面示例严格对齐当前项目真实规则格式，并同时包含 source、sink、transfer 三类规则效果。',
        ],
        code: {
          language: 'json',
          content: `{\n  "id": "asset.rule.project.demo_http",\n  "plane": "rule",\n  "status": "reviewed",\n  "surfaces": [\n    {\n      "surfaceId": "surface.source.project.demo_http.get_token",\n      "kind": "invoke",\n      "modulePath": "@project/account",\n      "ownerName": "AccountApi",\n      "methodName": "getToken",\n      "invokeKind": "instance",\n      "argCount": 0,\n      "confidence": "certain",\n      "provenance": {\n        "source": "manual"\n      }\n    },\n    {\n      "surfaceId": "surface.sink.project.demo_http.report",\n      "kind": "invoke",\n      "modulePath": "@project/report",\n      "ownerName": "Reporter",\n      "methodName": "send",\n      "invokeKind": "instance",\n      "argCount": 1,\n      "confidence": "certain",\n      "provenance": {\n        "source": "manual"\n      }\n    },\n    {\n      "surfaceId": "surface.transfer.project.demo_http.wrap_request",\n      "kind": "invoke",\n      "modulePath": "@project/http",\n      "ownerName": "HttpClient",\n      "methodName": "wrapRequest",\n      "invokeKind": "instance",\n      "argCount": 1,\n      "confidence": "certain",\n      "provenance": {\n        "source": "manual"\n      }\n    }\n  ],\n  "bindings": [\n    {\n      "bindingId": "binding.source.project.demo_http.get_token.return",\n      "surfaceId": "surface.source.project.demo_http.get_token",\n      "assetId": "asset.rule.project.demo_http",\n      "plane": "rule",\n      "role": "source",\n      "endpoint": {\n        "base": {\n          "kind": "return"\n        }\n      },\n      "selector": {\n        "kind": "method-name-equals",\n        "value": "getToken"\n      },\n      "effectTemplateRefs": [\n        "template.source.project.demo_http.get_token.return"\n      ],\n      "semanticsFamily": "source",\n      "completeness": "complete",\n      "confidence": "certain"\n    },\n    {\n      "bindingId": "binding.sink.project.demo_http.report.arg0",\n      "surfaceId": "surface.sink.project.demo_http.report",\n      "assetId": "asset.rule.project.demo_http",\n      "plane": "rule",\n      "role": "sink",\n      "endpoint": {\n        "base": {\n          "kind": "arg",\n          "index": 0\n        }\n      },\n      "selector": {\n        "kind": "method-name-equals",\n        "value": "send"\n      },\n      "effectTemplateRefs": [\n        "template.sink.project.demo_http.report.arg0"\n      ],\n      "semanticsFamily": "sink",\n      "completeness": "complete",\n      "confidence": "certain"\n    },\n    {\n      "bindingId": "binding.transfer.project.demo_http.wrap_request.arg0_to_result",\n      "surfaceId": "surface.transfer.project.demo_http.wrap_request",\n      "assetId": "asset.rule.project.demo_http",\n      "plane": "rule",\n      "role": "transfer",\n      "selector": {\n        "kind": "method-name-equals",\n        "value": "wrapRequest"\n      },\n      "effectTemplateRefs": [\n        "template.transfer.project.demo_http.wrap_request.arg0_to_result"\n      ],\n      "semanticsFamily": "transfer",\n      "completeness": "complete",\n      "confidence": "certain"\n    }\n  ],\n  "effectTemplates": [\n    {\n      "id": "template.source.project.demo_http.get_token.return",\n      "kind": "rule.source",\n      "confidence": "certain",\n      "value": {\n        "base": {\n          "kind": "return"\n        }\n      },\n      "sourceKind": "call_return"\n    },\n    {\n      "id": "template.sink.project.demo_http.report.arg0",\n      "kind": "rule.sink",\n      "confidence": "certain",\n      "value": {\n        "base": {\n          "kind": "arg",\n          "index": 0\n        }\n      },\n      "sinkKind": "information_leak"\n    },\n    {\n      "id": "template.transfer.project.demo_http.wrap_request.arg0_to_result",\n      "kind": "rule.transfer",\n      "confidence": "certain",\n      "from": {\n        "base": {\n          "kind": "arg",\n          "index": 0\n        }\n      },\n      "to": {\n        "base": {\n          "kind": "return"\n        }\n      },\n      "transferKind": "transfer"\n    }\n  ],\n  "provenance": {\n    "source": "project",\n    "projectId": "demo_http",\n    "evidenceLocations": [\n      {\n        "file": "arktaint/project/demo_http.rules.json",\n        "line": 1\n      }\n    ]\n  }\n}`,
        },
      },
      {
        title: 'LLM 配置模板示例',
        body: [
          '如果您选择“使用已有配置文件”，可以参考以下结构准备配置。该结构与当前后端生成临时配置时使用的核心字段保持一致。',
        ],
        code: {
          language: 'json',
          content: `{\n  "activeProfile": "default",\n  "profiles": {\n    "default": {\n      "provider": "openai-compatible",\n      "baseUrl": "https://api.example.com/v1",\n      "model": "your-model-name",\n      "apiKeyFile": "./default.key"\n    }\n  }\n}`,
        },
      },
      {
        title: '模块建模文件示例',
        body: [
          '当前项目中的模块建模文件不是“module + flows”这种简化格式，而是 InternalModuleLoweringIR JSON 结构。',
          '如果您上传模块建模文件，至少需要提供“id”和“semantics”。下面示例对应项目当前真实支持的 bridge 语义写法，用于表达“一个调用的参数流向另一个调用的回调参数”。',
        ],
        code: {
          language: 'json',
          content: `{\n  "id": "project.spec.callback_bridge",\n  "description": "Bridge register(value, callback) into callback parameter on the same call.",\n  "semantics": [\n    {\n      "id": "register_callback_bridge",\n      "kind": "bridge",\n      "from": {\n        "surface": {\n          "kind": "invoke",\n          "selector": {\n            "methodName": "register",\n            "instanceOnly": true,\n            "minArgs": 2\n          }\n        },\n        "slot": "arg",\n        "index": 0\n      },\n      "to": {\n        "surface": {\n          "kind": "invoke",\n          "selector": {\n            "methodName": "register",\n            "instanceOnly": true,\n            "minArgs": 2\n          }\n        },\n        "slot": "callback_param",\n        "callbackArgIndex": 1,\n        "paramIndex": 0\n      },\n      "dispatch": {\n        "preset": "callback_event",\n        "reason": "Project-CallbackBridge"\n      },\n      "emit": {\n        "reason": "Project-CallbackBridge",\n        "allowUnreachableTarget": true\n      }\n    }\n  ]\n}`,
        },
      },
    ],
  },
  {
    id: 'results',
    title: '结果查看',
    summary: '说明分析启动后页面会展示什么，分析完成后应该如何理解“运行输出”“产物”和“结果预览”。',
    blocks: [
      {
        title: '运行状态',
        body: [
          '运行状态区域会展示当前阶段、产物数量、当前项目和退出码。它用于帮助您判断任务目前执行到哪里，以及是否已经完成。',
        ],
      },
      {
        title: '运行输出',
        body: [
          '运行输出区域会实时显示桥接服务和分析引擎输出的日志内容。它是定位执行问题、确认任务是否正在推进的第一观察窗口。',
          '如果您怀疑任务卡住、失败或者没有生成结果，建议优先查看这里。',
        ],
      },
      {
        title: '产物列表',
        body: [
          '产物区域会展示分析过程中输出的结果文件路径，例如 summary、result 或 session 相关产物。',
          '点击产物项后，页面会复制路径，方便您在本地进一步查看文件。',
        ],
      },
      {
        title: '结果预览',
        body: [
          '结果预览区域会汇总分析项目数、完成项目数、失败项目数和当前报告状态。',
          '如果系统识别到可预览报告，点击“结果预览”后会优先读取 summary Markdown；若没有 Markdown，则会回退到 JSON 报告内容。',
        ],
      },
    ],
  },
  {
    id: 'faq',
    title: '常见问题',
    summary: '集中回答用户在接入、配置、运行和结果查看阶段最容易遇到的问题。',
    faq: [
      {
        q: '为什么上传 zip 后没有识别到项目？',
        a: '优先检查压缩包解压后的目录结构是否直接包含项目目录。如果最外层还有一层无关包装目录，系统可能只能识别到这层目录，而无法直接识别项目。',
      },
      {
        q: '为什么无法开始分析？',
        a: '通常是因为关键信息尚未补齐，例如项目接入信息不完整、LLM 辅助建模未完成，或者识别到的项目列表为空。建议先查看“确认启动”页中的待补充提示。',
      },
      {
        q: '为什么结果预览里显示“未生成”？',
        a: '说明当前运行还没有产出可预览的 summary 报告。常见原因包括分析尚未结束、运行失败，或者当前任务还没有输出面向用户的报告产物。',
      },
      {
        q: '哪些参数通常不需要改？',
        a: '一般只需要重点关注项目范围、分析深度和报告模式。对于上下文敏感层数、最长等待时间以及增强项配置，通常保持默认即可。',
      },
      {
        q: '规则文件、模块建模文件和插件需要全部配置吗？',
        a: '不需要。只有在默认能力无法覆盖您的业务语义时，才建议按需补充这些增强项。大多数情况下，可以先用默认能力完成一轮分析，再决定是否增强。',
      },
    ],
  },
];

export default function Docs() {
  const scrollToSection = (sectionId: string) => {
    const target = document.getElementById(sectionId);
    if (!target) return;

    const top = target.getBoundingClientRect().top + window.scrollY - 64;
    window.scrollTo({ top, behavior: 'smooth' });
  };

  return (
    <main className="experience-shell docs-page">
      <div className="docs-shell">
        <aside className="docs-sidebar">
          <div className="docs-sidebar-head">
            <span className="eyebrow">使用文档</span>
            <h3>ArkTaint 文档中心</h3>
            <p>围绕使用流程、参数理解、文件格式和模板准备，帮助用户顺利完成分析任务。</p>
          </div>
          <nav className="docs-nav" aria-label="使用文档目录">
            {docSections.map((section, index) => (
              <button
                key={section.id}
                type="button"
                className="docs-nav-item"
                onClick={() => scrollToSection(section.id)}
              >
                <span className="docs-nav-index">{String(index + 1).padStart(2, '0')}</span>
                <span>{section.title}</span>
              </button>
            ))}
          </nav>
        </aside>

        <div className="docs-content">
          {docSections.map(section => (
            <section key={section.id} id={section.id} className="docs-section">
              <div className="docs-section-head">
                <span className="eyebrow">{section.title}</span>
                <h2>{section.title}</h2>
              </div>

              {'blocks' in section && section.blocks ? (
                <div className="docs-block-stack">
                  {section.blocks.map(block => (
                    <article key={block.title} className="docs-block">
                      <h3>{block.title}</h3>
                      {block.body ? block.body.map((item: string) => <p key={item}>{item}</p>) : null}
                      {block.steps ? (
                        <ol className="docs-step-list">
                          {block.steps.map((item: string) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ol>
                      ) : null}
                      {block.bullets ? (
                        <ul className="docs-bullet-list">
                          {block.bullets.map((item: string) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                      ) : null}
                      {block.code ? (
                        <pre className="docs-code">
                          <code>{block.code.content}</code>
                        </pre>
                      ) : null}
                    </article>
                  ))}
                </div>
              ) : null}
              {'faq' in section && section.faq ? (
                <div className="docs-faq-list">
                  {section.faq.map(item => (
                    <article key={item.q} className="docs-faq-item">
                      <strong>{item.q}</strong>
                      <p>{item.a}</p>
                    </article>
                  ))}
                </div>
              ) : null}
            </section>
          ))}
        </div>
      </div>
    </main>
  );
}
