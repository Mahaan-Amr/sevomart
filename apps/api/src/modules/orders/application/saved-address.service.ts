import { createHash, randomUUID } from "node:crypto";

import {
  cartIdempotencyKeyContract,
  savedAddressIdContract,
  type CreateSavedAddressInput,
  type DeleteSavedAddressInput,
  type SavedAddress,
  type UpdateSavedAddressInput,
} from "@sevo/contracts/orders/v1";
import { identityIdContract } from "@sevo/contracts/platform/v1";

import type { SavedAddressRepository } from "../public";

export class SavedAddressService {
  constructor(private readonly repository: SavedAddressRepository) {}

  async list(identityId: string): Promise<{ addresses: SavedAddress[] }> {
    return {
      addresses: await this.repository.list(identityIdContract.parse(identityId)),
    };
  }

  create(
    identityId: string,
    input: CreateSavedAddressInput,
    idempotencyKey: string,
    correlationId: string,
  ) {
    return this.repository.create({
      addressId: savedAddressIdContract.parse(randomUUID()),
      identityId: identityIdContract.parse(identityId),
      input,
      idempotencyKey: cartIdempotencyKeyContract.parse(idempotencyKey),
      requestHash: requestHash(input),
      correlationId,
    });
  }

  update(
    identityId: string,
    addressId: string,
    input: UpdateSavedAddressInput,
    idempotencyKey: string,
    correlationId: string,
  ) {
    const { expectedRevision, ...fields } = input;
    return this.repository.update({
      addressId: savedAddressIdContract.parse(addressId),
      identityId: identityIdContract.parse(identityId),
      input: fields,
      expectedRevision,
      idempotencyKey: cartIdempotencyKeyContract.parse(idempotencyKey),
      requestHash: requestHash({ addressId, ...input }),
      correlationId,
    });
  }

  delete(
    identityId: string,
    addressId: string,
    input: DeleteSavedAddressInput,
    idempotencyKey: string,
    correlationId: string,
  ) {
    return this.repository.delete({
      addressId: savedAddressIdContract.parse(addressId),
      identityId: identityIdContract.parse(identityId),
      expectedRevision: input.expectedRevision,
      idempotencyKey: cartIdempotencyKeyContract.parse(idempotencyKey),
      requestHash: requestHash({ addressId, ...input }),
      correlationId,
    });
  }
}

function requestHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
