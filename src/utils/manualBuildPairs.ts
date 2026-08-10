export interface ManualBuildPair {
  label?: string;
  folder: string;
  map: string;
  elf: string;
}

export interface InspectedManualBuildPairs {
  defaultValue?: readonly ManualBuildPair[];
  globalValue?: readonly ManualBuildPair[];
  workspaceValue?: readonly ManualBuildPair[];
}

export type ManualBuildPairTarget = 'user' | 'workspace';

export function getManualBuildPairsForTarget(
  inspected: InspectedManualBuildPairs | undefined,
  target: ManualBuildPairTarget
): ManualBuildPair[] {
  const configured = target === 'user'
    ? inspected?.globalValue ?? inspected?.defaultValue
    : inspected?.workspaceValue
      ?? inspected?.globalValue
      ?? inspected?.defaultValue;
  return configured ? [...configured] : [];
}

export function validateRequiredPath(value: string): string | undefined {
  return value.trim().length > 0 ? undefined : 'A non-empty path is required.';
}
