import * as fs from "fs";
import * as path from "path";
import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../../arkanalyzer/out/src/Config";
import { detectSinksByExactMethodsForTest, resolveUniqueMethodByExactNameForTest } from "../helpers/ExactSinkDetectionTestUtils";
import {
    buildEngineForCase,
    collectCaseSeedNodes,
    findCaseMethod,
    resolveCaseMethod,
} from "../helpers/SyntheticCaseHarness";

interface CaseSpec {
    name: string;
    expected: boolean;
    sinkName: string;
    code: string;
}

interface CaseResult {
    name: string;
    expected: boolean;
    detected: boolean;
    seedCount: number;
    pass: boolean;
}

const TAINT_MOCK = `
export const taint = {
  Sink(_value: unknown): void {
  },
  SinkA(_value: unknown): void {
  },
  SinkB(_value: unknown): void {
  }
};

export const hilog = {
  error(_value: unknown): void {
  },
  debug(_value: unknown): void {
  },
  warn(_value: unknown): void {
  }
};
`;

const CASES: CaseSpec[] = [
    {
        name: "shared_helper_match_T",
        expected: true,
        sinkName: "Sink",
        code: `
import { taint } from "./taint_mock";

function sharedHelper(value: string): string {
  return value;
}

export function shared_helper_match_T(taint_src: string): void {
  const value = sharedHelper(taint_src);
  taint.Sink(value);
}
`,
    },
    {
        name: "shared_helper_two_callers_no_cross_F",
        expected: false,
        sinkName: "SinkB",
        code: `
import { taint } from "./taint_mock";

function sharedHelper(value: string): string {
  return value;
}

function taintedCaller(value: string): void {
  const carried = sharedHelper(value);
  const _hold = carried;
}

function cleanCaller(): void {
  const carried = sharedHelper("clean");
  taint.SinkB(carried);
}

export function shared_helper_two_callers_no_cross_F(taint_src: string): void {
  taintedCaller(taint_src);
  cleanCaller();
}
`,
    },
    {
        name: "rest_carrier_match_T",
        expected: true,
        sinkName: "Sink",
        code: `
import { taint } from "./taint_mock";

function consume(value: string): void {
  taint.Sink(value);
}

function collectRest(...items: string[]): void {
  let joined = "";
  items.forEach((item: string): void => {
    joined = joined + item;
  });
  consume(joined);
}

export function rest_carrier_match_T(taint_src: string): void {
  collectRest("prefix", taint_src);
}
`,
    },
    {
        name: "rest_carrier_two_callers_no_cross_F",
        expected: false,
        sinkName: "SinkB",
        code: `
import { taint } from "./taint_mock";

function collectRest(...items: string[]): string {
  return items[1];
}

function taintedRestCaller(value: string): void {
  const carried = collectRest("prefix", value);
  const _hold = carried;
}

function cleanRestCaller(): void {
  const carried = collectRest("prefix", "clean");
  taint.SinkB(carried);
}

export function rest_carrier_two_callers_no_cross_F(taint_src: string): void {
  taintedRestCaller(taint_src);
  cleanRestCaller();
}
`,
    },
    {
        name: "return_context_match_T",
        expected: true,
        sinkName: "Sink",
        code: `
import { taint } from "./taint_mock";

function identity(value: string): string {
  return value;
}

export function return_context_match_T(taint_src: string): void {
  const fromTaint = identity(taint_src);
  const fromClean = identity("clean");
  const _hold = fromClean;
  taint.Sink(fromTaint);
}
`,
    },
    {
        name: "return_context_mismatch_skip_F",
        expected: false,
        sinkName: "Sink",
        code: `
import { taint } from "./taint_mock";

function identity(value: string): string {
  return value;
}

export function return_context_mismatch_skip_F(taint_src: string): void {
  const fromTaint = identity(taint_src);
  const fromClean = identity("clean");
  const _hold = fromTaint;
  taint.Sink(fromClean);
}
`,
    },
    {
        name: "logger_static_rest_error_match_T",
        expected: true,
        sinkName: "error",
        code: `
import { hilog } from "./taint_mock";

class Logger {
  private static wrapArgs(tag: string, args: string[]): string[] {
    args.splice(0, 0, tag);
    return args;
  }

  static d(tag: string, ...args: string[]): void {
    const packed = Logger.wrapArgs(tag, args);
    hilog.debug(packed);
  }

  static e(tag: string, ...args: string[]): void {
    const packed = Logger.wrapArgs(tag, args);
    hilog.error(packed);
  }

  static w(tag: string, ...args: string[]): void {
    const packed = Logger.wrapArgs(tag, args);
    hilog.warn(packed);
  }
}

function searchCaller(value: string): void {
  Logger.e("search", value);
}

export function logger_static_rest_error_match_T(taint_src: string): void {
  searchCaller(taint_src);
}
`,
    },
    {
        name: "logger_static_rest_error_not_debug_F",
        expected: false,
        sinkName: "debug",
        code: `
import { hilog } from "./taint_mock";

class Logger {
  private static wrapArgs(tag: string, args: string[]): string[] {
    args.splice(0, 0, tag);
    return args;
  }

  static d(tag: string, ...args: string[]): void {
    const packed = Logger.wrapArgs(tag, args);
    hilog.debug(packed);
  }

  static e(tag: string, ...args: string[]): void {
    const packed = Logger.wrapArgs(tag, args);
    hilog.error(packed);
  }

  static w(tag: string, ...args: string[]): void {
    const packed = Logger.wrapArgs(tag, args);
    hilog.warn(packed);
  }
}

function searchCaller(value: string): void {
  Logger.e("search", value);
}

function cleanDebugCaller(): void {
  Logger.d("debug", "clean");
}

export function logger_static_rest_error_not_debug_F(taint_src: string): void {
  searchCaller(taint_src);
  cleanDebugCaller();
}
`,
    },
    {
        name: "logger_static_rest_error_not_warn_F",
        expected: false,
        sinkName: "warn",
        code: `
import { hilog } from "./taint_mock";

class Logger {
  private static wrapArgs(tag: string, args: string[]): string[] {
    args.splice(0, 0, tag);
    return args;
  }

  static d(tag: string, ...args: string[]): void {
    const packed = Logger.wrapArgs(tag, args);
    hilog.debug(packed);
  }

  static e(tag: string, ...args: string[]): void {
    const packed = Logger.wrapArgs(tag, args);
    hilog.error(packed);
  }

  static w(tag: string, ...args: string[]): void {
    const packed = Logger.wrapArgs(tag, args);
    hilog.warn(packed);
  }
}

function searchCaller(value: string): void {
  Logger.e("search", value);
}

function cleanWarnCaller(): void {
  Logger.w("warn", "clean");
}

export function logger_static_rest_error_not_warn_F(taint_src: string): void {
  searchCaller(taint_src);
  cleanWarnCaller();
}
`,
    },
];

function prepareCaseProject(testCase: CaseSpec): string {
    const projectDir = path.resolve("tmp", "test_runs", "call_context_precision", testCase.name);
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(path.join(projectDir, "taint_mock.ts"), TAINT_MOCK, "utf-8");
    fs.writeFileSync(path.join(projectDir, `${testCase.name}.ets`), testCase.code.trimStart(), "utf-8");
    return projectDir;
}

function buildScene(projectDir: string): Scene {
    const config = new SceneConfig();
    config.buildFromProjectDir(projectDir);
    const scene = new Scene();
    scene.buildSceneFromProjectDir(config);
    scene.inferTypes();
    return scene;
}

async function runCase(testCase: CaseSpec): Promise<CaseResult> {
    const projectDir = prepareCaseProject(testCase);
    const scene = buildScene(projectDir);
    const relativePath = `${testCase.name}.ets`;
    const entry = resolveCaseMethod(scene, relativePath, testCase.name);
    const entryMethod = findCaseMethod(scene, entry);
    if (!entryMethod) {
        throw new Error(`Entry method not found for ${testCase.name}`);
    }

    const engine = await buildEngineForCase(scene, 1, entryMethod, { verbose: false });
    const seeds = collectCaseSeedNodes(engine, entryMethod);
    if (seeds.length > 0) {
        engine.propagateWithSeeds(seeds);
    }
    const sinkMethod = resolveUniqueMethodByExactNameForTest(engine, testCase.sinkName);
    const flows = detectSinksByExactMethodsForTest(engine, sinkMethod);
    const detected = flows.length > 0;
    return {
        name: testCase.name,
        expected: testCase.expected,
        detected,
        seedCount: seeds.length,
        pass: detected === testCase.expected && seeds.length > 0,
    };
}

async function main(): Promise<void> {
    const results: CaseResult[] = [];
    for (const testCase of CASES) {
        results.push(await runCase(testCase));
    }

    const passCount = results.filter(r => r.pass).length;
    console.log("====== Call Context Precision Test ======");
    console.log(`total_cases=${results.length}`);
    console.log(`pass_cases=${passCount}`);
    console.log(`fail_cases=${results.length - passCount}`);
    for (const result of results) {
        console.log(
            `${result.pass ? "PASS" : "FAIL"} ${result.name} `
            + `expected=${result.expected ? "T" : "F"} `
            + `detected=${result.detected} seeds=${result.seedCount}`,
        );
    }

    if (passCount !== results.length) {
        process.exitCode = 1;
    }
}

main().catch(err => {
    console.error(err);
    process.exitCode = 1;
});
