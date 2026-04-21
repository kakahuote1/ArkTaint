/**
 * 从指定目录中提取指定后缀名的所有文件
 * @param srcPath string 要提取文件的项目入口，相对或绝对路径都可
 * @param exts string[] 要提取的文件扩展名数组，每个扩展名需以点开头
 * @param filenameArr string[] 用来存放提取出的文件的原始路径的数组，可不传，默认为空数组
 * @param visited: Set<string> 用来存放已经访问过的路径，避免递归栈溢出，可不传，默认为空数组
 * @return string[] 提取出的文件的原始路径数组
 */
export declare function getAllFiles(srcPath: string, exts: string[], ignore?: string[], filenameArr?: string[], visited?: Set<string>): string[];
//# sourceMappingURL=getAllFiles.d.ts.map