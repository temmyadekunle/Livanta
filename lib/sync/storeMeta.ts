/**
 * Account-store sync bookkeeping.
 *
 * The Stage 2 metadata module deliberately only addresses the anonymous
 * database. Account sync must never read or write that database, so these
 * helpers take the account's LocalStore and keep the cursor, tombstones,
 * pending dismissals and settings fingerprint inside it.
 *
 * The key names and record shape are shared with the anonymous module so that
 * an account record stays recognisable, but ownership is checked against the
 * store's scope as well as the record's stamp.
 */

import { databaseNameForScope, LocalStore } from "../db.ts";
import type { Settings } from "../settings.ts";
import {
  emptySyncMeta,
  SyncOwnershipError,
  syncMetaKey,
  syncOwner,
  type SyncMeta,
  type SyncOwner,
} from "./meta.ts";

/** Owner-scoped fingerprint of the settings last pushed or accepted. */
export const SETTINGS_FINGERPRINT_KEY = "__livanta_sync_settings_fingerprint";

/**
 * Returns the owner an account store belongs to, rejecting anything that is
 * not a real account store. No caller may fall back to the anonymous database.
 */
export function accountStoreOwner(store: LocalStore): SyncOwner {
  if (!(store instanceof LocalStore)) {
    throw new SyncOwnershipError(
      "Account sync requires an explicit account store.",
    );
  }
  const scope = store.scope;
  if (scope.kind !== "user") {
    throw new SyncOwnershipError(
      "Account sync refuses to use the anonymous local database.",
    );
  }
  if (store.databaseName !== databaseNameForScope(scope)) {
    throw new SyncOwnershipError(
      "The account store does not address its own database.",
    );
  }
  return syncOwner(scope.userId);
}

/** Re-validates a store against an owner derived earlier in the cycle. */
export function assertAccountStore(
  store: LocalStore,
  owner: SyncOwner,
): SyncOwner {
  const actual = accountStoreOwner(store);
  if (actual.userId !== syncOwner(owner.userId).userId) {
    throw new SyncOwnershipError(
      "The local account store does not belong to the syncing account.",
    );
  }
  return actual;
}

function coerce(raw: unknown, owner: SyncOwner): SyncMeta {
  const empty = emptySyncMeta(owner);
  if (!raw || typeof raw !== "object") return empty;

  const value = raw as Partial<SyncMeta>;
  if (
    value.ownerId !== undefined &&
    value.ownerId !== null &&
    typeof value.ownerId !== "string"
  ) {
    throw new SyncOwnershipError(
      "Sync bookkeeping has an invalid account stamp.",
    );
  }

  const storedOwner =
    typeof value.ownerId === "string" ? value.ownerId.toLowerCase() : null;
  if (storedOwner !== owner.userId) {
    throw new SyncOwnershipError(
      "Sync bookkeeping belongs to a different account; refusing to reuse it.",
    );
  }

  return {
    ownerId: owner.userId,
    cursor: typeof value.cursor === "string" ? value.cursor : null,
    settingsUpdatedAt:
      typeof value.settingsUpdatedAt === "string"
        ? value.settingsUpdatedAt
        : null,
    tombstones:
      value.tombstones &&
      typeof value.tombstones === "object" &&
      !Array.isArray(value.tombstones)
        ? value.tombstones
        : {},
    pendingDismissals:
      value.pendingDismissals &&
      typeof value.pendingDismissals === "object" &&
      !Array.isArray(value.pendingDismissals)
        ? value.pendingDismissals
        : {},
    seeded: value.seeded === true,
  };
}

export async function readStoreSyncMeta(
  store: LocalStore,
  owner: SyncOwner,
): Promise<SyncMeta> {
  const normalized = assertAccountStore(store, owner);
  return coerce(
    await store.getSetting<unknown>(syncMetaKey(normalized)),
    normalized,
  );
}

export async function writeStoreSyncMeta(
  store: LocalStore,
  meta: SyncMeta,
  owner: SyncOwner,
): Promise<void> {
  const normalized = assertAccountStore(store, owner);
  if ((meta.ownerId ?? null) !== normalized.userId) {
    throw new SyncOwnershipError(
      "Refusing to store sync bookkeeping under a different account.",
    );
  }
  await store.putSetting(syncMetaKey(normalized), {
    ...meta,
    ownerId: normalized.userId,
  });
}

/**
 * A stable representation of the settings that sync cares about. Key order is
 * fixed so the same values always produce the same fingerprint.
 */
export function settingsFingerprint(settings: Settings): string {
  return JSON.stringify([
    settings.onboarded,
    settings.displayName,
    settings.avatar,
    settings.locale,
    settings.dataSaver,
    settings.notifyUrgent,
    settings.leadDays,
    settings.managedCategories,
  ]);
}

function fingerprintKey(owner: SyncOwner): string {
  return `${SETTINGS_FINGERPRINT_KEY}:user:${owner.userId}`;
}

export async function readSettingsFingerprint(
  store: LocalStore,
  owner: SyncOwner,
): Promise<string | null> {
  const normalized = assertAccountStore(store, owner);
  const value = await store.getSetting<unknown>(fingerprintKey(normalized));
  return typeof value === "string" ? value : null;
}

export async function writeSettingsFingerprint(
  store: LocalStore,
  owner: SyncOwner,
  fingerprint: string,
): Promise<void> {
  const normalized = assertAccountStore(store, owner);
  await store.putSetting(fingerprintKey(normalized), fingerprint);
}
