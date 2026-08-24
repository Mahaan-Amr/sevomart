import { randomUUID } from "node:crypto";

import {
  savedAddressContract,
  savedAddressIdContract,
  type CreateSavedAddressInput,
  type SavedAddress,
  type SavedAddressId,
} from "@sevo/contracts/orders/v1";
import type { IdentityId } from "@sevo/contracts/platform/v1";
import postgres, { type JSONValue, type Sql } from "postgres";

import {
  SavedAddressIdempotencyConflictError,
  SavedAddressIdempotencyInProgressError,
  SavedAddressNotFoundError,
  SavedAddressRevisionConflictError,
  type SavedAddressRepository,
} from "../public";

type AddressRow = {
  addressId: string;
  identityId: string;
  revision: number;
  recipientName: string;
  recipientMobile: string;
  provinceText: string;
  cityText: string;
  addressLine: string;
  postalCode: string | null;
};

export class PostgresSavedAddressRepository implements SavedAddressRepository {
  readonly #sql: Sql;

  constructor(databaseUrl: string) {
    this.#sql = postgres(databaseUrl, { max: 5 });
  }

  async list(identityId: IdentityId): Promise<SavedAddress[]> {
    const rows = await this.#readCurrent(this.#sql, identityId);
    return rows.map(toSavedAddress);
  }

  async create(command: {
    addressId: SavedAddressId;
    identityId: IdentityId;
    input: CreateSavedAddressInput;
    idempotencyKey: string;
    requestHash: string;
    correlationId: string;
  }): Promise<SavedAddress> {
    return this.#runIdempotently("CREATE", command, () =>
      this.#sql.begin(async (sql) => {
        const replay = await this.#claimIdempotency(sql, "CREATE", command);
        if (replay) return savedAddressContract.parse(replay);
        await advisoryLock(sql, `saved-address:${command.identityId}`);
        await sql`
        insert into order_saved_addresses (id, identity_id, current_revision)
        values (${command.addressId}, ${command.identityId}, 1)
      `;
        await insertRevision(sql, command.addressId, 1, command.input);
        const result = savedAddressContract.parse({
          addressId: command.addressId,
          revision: 1,
          ...command.input,
        });
        await writeAudit(sql, command, command.addressId, 1, "CREATE");
        await this.#completeIdempotency(sql, "CREATE", command, result);
        return result;
      }),
    );
  }

  async update(command: {
    addressId: SavedAddressId;
    identityId: IdentityId;
    input: CreateSavedAddressInput;
    expectedRevision: number;
    idempotencyKey: string;
    requestHash: string;
    correlationId: string;
  }): Promise<SavedAddress> {
    return this.#runIdempotently("UPDATE", command, () =>
      this.#sql.begin(async (sql) => {
        const replay = await this.#claimIdempotency(sql, "UPDATE", command);
        if (replay) return savedAddressContract.parse(replay);
        await advisoryLock(sql, `saved-address:${command.addressId}`);
        const current = await this.#readOneForUpdate(
          sql,
          command.identityId,
          command.addressId,
        );
        if (!current) throw new SavedAddressNotFoundError();
        if (current.revision !== command.expectedRevision) {
          throw new SavedAddressRevisionConflictError(toSavedAddress(current));
        }
        const revision = current.revision + 1;
        await insertRevision(sql, command.addressId, revision, command.input);
        await sql`
        update order_saved_addresses set current_revision = ${revision}, updated_at = now()
        where id = ${command.addressId}
      `;
        const result = savedAddressContract.parse({
          addressId: command.addressId,
          revision,
          ...command.input,
        });
        await writeAudit(sql, command, command.addressId, revision, "UPDATE");
        await this.#completeIdempotency(sql, "UPDATE", command, result);
        return result;
      }),
    );
  }

  async delete(command: {
    addressId: SavedAddressId;
    identityId: IdentityId;
    expectedRevision: number;
    idempotencyKey: string;
    requestHash: string;
    correlationId: string;
  }): Promise<void> {
    await this.#runIdempotently("DELETE", command, () =>
      this.#sql.begin(async (sql) => {
        const replay = await this.#claimIdempotency(sql, "DELETE", command);
        if (replay) return;
        await advisoryLock(sql, `saved-address:${command.addressId}`);
        const current = await this.#readOneForUpdate(
          sql,
          command.identityId,
          command.addressId,
        );
        if (!current) throw new SavedAddressNotFoundError();
        if (current.revision !== command.expectedRevision) {
          throw new SavedAddressRevisionConflictError(toSavedAddress(current));
        }
        await sql`
        update order_saved_addresses set status = 'DELETED', updated_at = now()
        where id = ${command.addressId}
      `;
        await writeAudit(sql, command, command.addressId, current.revision, "DELETE");
        await this.#completeIdempotency(sql, "DELETE", command, { deleted: true });
      }),
    );
  }

  async #readCurrent(sql: Sql, identityId: IdentityId): Promise<AddressRow[]> {
    return sql<AddressRow[]>`
      select a.id as "addressId", a.identity_id as "identityId",
        a.current_revision as revision, r.recipient_name as "recipientName",
        r.recipient_mobile as "recipientMobile", r.province_text as "provinceText",
        r.city_text as "cityText", r.address_line as "addressLine",
        r.postal_code as "postalCode"
      from order_saved_addresses a
      join order_saved_address_revisions r
        on r.address_id = a.id and r.revision = a.current_revision
      where a.identity_id = ${identityId} and a.status = 'ACTIVE'
      order by a.updated_at desc, a.id
    `;
  }

  async #readOneForUpdate(
    sql: Sql,
    identityId: IdentityId,
    addressId: SavedAddressId,
  ): Promise<AddressRow | undefined> {
    const rows = await sql<AddressRow[]>`
      select a.id as "addressId", a.identity_id as "identityId",
        a.current_revision as revision, r.recipient_name as "recipientName",
        r.recipient_mobile as "recipientMobile", r.province_text as "provinceText",
        r.city_text as "cityText", r.address_line as "addressLine",
        r.postal_code as "postalCode"
      from order_saved_addresses a
      join order_saved_address_revisions r
        on r.address_id = a.id and r.revision = a.current_revision
      where a.id = ${addressId} and a.identity_id = ${identityId}
        and a.status = 'ACTIVE'
      for update of a
    `;
    return rows[0];
  }

  async #claimIdempotency(
    sql: Sql,
    operation: string,
    command: { identityId: IdentityId; idempotencyKey: string; requestHash: string },
  ): Promise<JSONValue | undefined> {
    const lockKey = `saved-address:${operation}:${command.identityId}:${command.idempotencyKey}`;
    const lock = await sql<Array<{ locked: boolean }>>`
      select pg_try_advisory_xact_lock(hashtextextended(${lockKey}, 0)) as locked
    `;
    if (!lock[0]?.locked) throw new SavedAddressIdempotencyInProgressError();
    const rows = await sql<
      Array<{
        requestHash: string;
        state: string;
        lockedUntil: Date;
        responseJson: JSONValue | null;
      }>
    >`
      select request_hash as "requestHash", state,
        locked_until as "lockedUntil", response_json as "responseJson"
      from order_saved_address_idempotency_records
      where operation = ${operation} and identity_id = ${command.identityId}
        and key = ${command.idempotencyKey}
    `;
    const row = rows[0];
    if (row?.requestHash !== undefined && row.requestHash !== command.requestHash) {
      throw new SavedAddressIdempotencyConflictError();
    }
    if (row?.state === "COMPLETED" && row.responseJson !== null) {
      replaySavedAddressFailure(row.responseJson);
      return row.responseJson;
    }
    if (row && row.lockedUntil.getTime() > Date.now()) {
      throw new SavedAddressIdempotencyInProgressError();
    }
    if (row) {
      await sql`
        update order_saved_address_idempotency_records
        set state = 'IN_PROGRESS', locked_until = now() + interval '30 seconds',
          response_json = null, completed_at = null
        where operation = ${operation} and identity_id = ${command.identityId}
          and key = ${command.idempotencyKey}
      `;
    } else {
      await sql`
        insert into order_saved_address_idempotency_records
          (operation, identity_id, key, request_hash, state, locked_until)
        values
          (${operation}, ${command.identityId}, ${command.idempotencyKey},
           ${command.requestHash}, 'IN_PROGRESS', now() + interval '30 seconds')
      `;
    }
    return undefined;
  }

  async #completeIdempotency(
    sql: Sql,
    operation: string,
    command: { identityId: IdentityId; idempotencyKey: string },
    response: unknown,
  ) {
    await sql`
      update order_saved_address_idempotency_records
      set state = 'COMPLETED', locked_until = now(), completed_at = now(),
        response_json = ${sql.json(JSON.parse(JSON.stringify(response)) as JSONValue)}
      where operation = ${operation} and identity_id = ${command.identityId}
        and key = ${command.idempotencyKey}
    `;
  }

  async #runIdempotently<T>(
    operation: string,
    command: {
      identityId: IdentityId;
      idempotencyKey: string;
      requestHash: string;
      correlationId: string;
    },
    execute: () => Promise<T>,
  ): Promise<T> {
    try {
      return await execute();
    } catch (error) {
      const failure = savedAddressFailure(error, command.correlationId);
      if (failure) {
        await this.#sql`
          insert into order_saved_address_idempotency_records
            (operation, identity_id, key, request_hash, state, locked_until,
             response_json, completed_at)
          values (${operation}, ${command.identityId}, ${command.idempotencyKey},
            ${command.requestHash}, 'COMPLETED', now(), ${this.#sql.json(failure)}, now())
          on conflict (operation, identity_id, key) do nothing
        `;
      }
      throw error;
    }
  }

  async onModuleDestroy() {
    await this.#sql.end();
  }
}

function savedAddressFailure(
  error: unknown,
  correlationId: string,
): JSONValue | undefined {
  if (error instanceof SavedAddressNotFoundError) {
    return { failureCode: "ADDRESS_NOT_FOUND", correlationId };
  }
  if (error instanceof SavedAddressRevisionConflictError) {
    return {
      failureCode: "ADDRESS_REVISION_CONFLICT",
      correlationId,
      ...(error.current ? { current: error.current as unknown as JSONValue } : {}),
    };
  }
  return undefined;
}

function replaySavedAddressFailure(value: JSONValue) {
  if (!value || Array.isArray(value) || typeof value !== "object") return;
  const failure = value as Record<string, JSONValue | undefined>;
  if (failure.failureCode === "ADDRESS_NOT_FOUND") {
    throw withReplayCorrelation(new SavedAddressNotFoundError(), failure.correlationId);
  }
  if (failure.failureCode === "ADDRESS_REVISION_CONFLICT") {
    throw withReplayCorrelation(
      new SavedAddressRevisionConflictError(
        failure.current ? savedAddressContract.parse(failure.current) : undefined,
      ),
      failure.correlationId,
    );
  }
}

function withReplayCorrelation<T extends Error>(
  error: T,
  value: JSONValue | undefined,
): T {
  return Object.assign(error, {
    replayedCorrelationId: typeof value === "string" ? value : undefined,
  });
}

function toSavedAddress(row: AddressRow): SavedAddress {
  return savedAddressContract.parse({
    addressId: savedAddressIdContract.parse(row.addressId),
    revision: row.revision,
    recipientName: row.recipientName,
    recipientMobile: row.recipientMobile,
    provinceText: row.provinceText,
    cityText: row.cityText,
    addressLine: row.addressLine,
    ...(row.postalCode ? { postalCode: row.postalCode.trim() } : {}),
  });
}

async function insertRevision(
  sql: Sql,
  addressId: SavedAddressId,
  revision: number,
  input: CreateSavedAddressInput,
) {
  await sql`
    insert into order_saved_address_revisions
      (address_id, revision, recipient_name, recipient_mobile, province_text,
       city_text, address_line, postal_code)
    values
      (${addressId}, ${revision}, ${input.recipientName}, ${input.recipientMobile},
       ${input.provinceText}, ${input.cityText}, ${input.addressLine},
       ${input.postalCode ?? null})
  `;
}

async function writeAudit(
  sql: Sql,
  command: { identityId: IdentityId; correlationId: string },
  addressId: SavedAddressId,
  revision: number,
  operation: "CREATE" | "UPDATE" | "DELETE",
) {
  await sql`
    insert into order_saved_address_audits
      (id, address_id, identity_id, operation, revision, correlation_id)
    values
      (${randomUUID()}, ${addressId}, ${command.identityId}, ${operation},
       ${revision}, ${command.correlationId})
  `;
}

async function advisoryLock(sql: Sql, key: string) {
  await sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
}
