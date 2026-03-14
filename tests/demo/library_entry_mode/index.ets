function a_internal_helper(taint_src: string): string {
    return "helper_" + taint_src;
}

export function z_exported_entry(taint_src: string): string {
    return a_internal_helper(taint_src);
}
