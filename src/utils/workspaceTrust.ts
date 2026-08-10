export const WORKSPACE_TRUST_MESSAGE =
  'STM32 Build Analyzer: trust this workspace before running build analysis. '
  + 'The extension executes native objdump and nm tools against workspace build artifacts.';

export function assertWorkspaceTrusted(isTrusted: boolean): void {
  if (!isTrusted) {
    throw new Error(WORKSPACE_TRUST_MESSAGE);
  }
}
