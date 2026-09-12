/** Host-reviewed native observations. Unknown driver capabilities remain actions. */
const observationTools = new Set([
  'get_accessibility_tree', 'get_window_state', 'get_browser_state', 'list_windows',
]);

export function isCuaObservationTool(name: string, input: Record<string, unknown>): boolean {
  // Optional file exports are effects, even on an otherwise observational tool.
  return observationTools.has(name) && !Object.entries(input).some(([key, value]) =>
    /(?:out_?file|output_?path|save_?path)/iu.test(key) && value != null);
}
