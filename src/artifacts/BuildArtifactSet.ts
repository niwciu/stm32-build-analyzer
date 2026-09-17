/**
 * Build outputs available for detection and analysis.
 *
 * Paths are optional so discovery failures and incomplete user configuration
 * can be represented and reported as `invalid` results instead of exceptions.
 */
export interface BuildArtifactSet {
  readonly executablePath?: string;
  readonly mapPath?: string;
  readonly linkerScriptPaths: readonly string[];
  readonly workspaceFolder?: string;
}
