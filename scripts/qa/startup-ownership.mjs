export async function runOwnedQaStartup(operations) {
  let ownershipToken;
  let mayHaveCreatedProjectResources = false;
  try {
    ownershipToken = await operations.acquireOwnership();
    await operations.assertProjectAbsent();
    mayHaveCreatedProjectResources = true;
    await operations.startProject();
    return await operations.initializeProject();
  } catch (error) {
    if (mayHaveCreatedProjectResources) {
      try {
        await operations.cleanupProject();
      } catch {
        // Preserve the startup failure; project ownership remains scoped by its claim.
      }
    }
    if (ownershipToken) {
      try {
        await operations.releaseOwnership(ownershipToken);
      } catch {
        // Preserve the startup failure and fail closed if claim cleanup is uncertain.
      }
    }
    throw error;
  }
}
