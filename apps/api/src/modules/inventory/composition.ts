import { Module } from "@nestjs/common";

@Module({})
export class InventoryModule {}

export { PostgresInventoryAuthoring } from "./infrastructure/postgres-inventory-authoring";
