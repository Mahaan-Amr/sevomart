import { DevOtpProvider } from "../../apps/api/src/modules/notifications/testing/dev-otp-provider";
import { runOtpProviderContract } from "./otp-provider.contract";

runOtpProviderContract("DevOtpProvider", () => new DevOtpProvider());
