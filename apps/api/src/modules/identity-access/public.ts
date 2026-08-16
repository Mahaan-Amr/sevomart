import type { IranianMobile, OtpCode } from "@sevo/contracts/identity-access/v1";

export type OtpDelivery = {
  mobile: IranianMobile;
  code: OtpCode;
  expiresAt: Date;
  correlationId: string;
};

export type OtpDeliveryReceipt = {
  providerReference: string;
};

export interface OtpProvider {
  deliverOtp(delivery: OtpDelivery): Promise<OtpDeliveryReceipt>;
}
