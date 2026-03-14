import type { Logger } from 'log4js';
export declare enum LOG_LEVEL {
    ERROR = "ERROR",
    WARN = "WARN",
    INFO = "INFO",
    DEBUG = "DEBUG",
    TRACE = "TRACE"
}
export declare enum LOG_MODULE_TYPE {
    DEFAULT = "default",
    ARKANALYZER = "ArkAnalyzer",
    HOMECHECK = "HomeCheck",
    HOMEFLOW = "HomeFlow",
    TOOL = "Tool"
}
export default class ConsoleLogger {
    static configure(logFilePath: string, arkanalyzer_level?: LOG_LEVEL, tool_level?: LOG_LEVEL, use_console?: boolean): void;
    static getLogger(log_type: LOG_MODULE_TYPE, tag?: string): Logger;
}
