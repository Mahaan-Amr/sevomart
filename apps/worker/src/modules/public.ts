import type { RuntimeEnvironment } from "@sevo/config";

export type StopWorkerHandler = () => Promise<void>;

export interface WorkerHandler {
  start(environment: RuntimeEnvironment): Promise<StopWorkerHandler>;
}
