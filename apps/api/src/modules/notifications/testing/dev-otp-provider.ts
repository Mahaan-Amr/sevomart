import { randomUUID } from "node:crypto";

import type {
  OtpDelivery,
  OtpDeliveryReceipt,
  OtpProvider,
} from "../../identity-access/public";

export class DevOtpProvider implements OtpProvider {
  async deliverOtp(delivery: OtpDelivery): Promise<OtpDeliveryReceipt> {
    void delivery;
    return { providerReference: `dev-otp:${randomUUID()}` };
  }
}
