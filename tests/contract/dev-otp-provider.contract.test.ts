import { DevOtpProvider } from "../../apps/api/src/modules/identity-access/infrastructure/dev-otp-provider";
import { runOtpProviderContract } from "./otp-provider.contract";

runOtpProviderContract("DevOtpProvider", () => new DevOtpProvider());
