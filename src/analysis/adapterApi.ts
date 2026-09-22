import type { ToolchainAdapter } from './contracts';

/**
 * Version of the built-in adapter contribution contract.
 *
 * This is intentionally not an extension-host plugin API. See the adapter
 * author guide for the compatibility and trust requirements that must be met
 * before runtime registration can be exposed.
 */
export const TOOLCHAIN_ADAPTER_API_VERSION = 1 as const;

export type ToolchainAdapterApiVersion =
  typeof TOOLCHAIN_ADAPTER_API_VERSION;

export interface ToolchainAdapterContributionV1 {
  readonly apiVersion: typeof TOOLCHAIN_ADAPTER_API_VERSION;
  readonly adapter: ToolchainAdapter;
}

export type ToolchainAdapterContribution = ToolchainAdapterContributionV1;

/** Defines a built-in adapter against the version 1 compatibility boundary. */
export function defineToolchainAdapterV1(
  adapter: ToolchainAdapter
): ToolchainAdapterContributionV1 {
  return Object.freeze({
    apiVersion: TOOLCHAIN_ADAPTER_API_VERSION,
    adapter,
  });
}

export function assertSupportedAdapterContribution(
  contribution: ToolchainAdapterContribution
): void {
  if (contribution.apiVersion !== TOOLCHAIN_ADAPTER_API_VERSION) {
    throw new Error(
      `Unsupported toolchain adapter API version: ${String(contribution.apiVersion)}.`
    );
  }
}
