export type OtpDestination = {
  mobile: string;
};

export type OtpChallenge = {
  challengeId: string;
  expiresAt: Date;
};

export type OtpVerification = {
  challengeId: string;
  code: string;
};

export interface OtpProvider {
  requestChallenge(destination: OtpDestination): Promise<OtpChallenge>;
  verifyChallenge(verification: OtpVerification): Promise<boolean>;
}
