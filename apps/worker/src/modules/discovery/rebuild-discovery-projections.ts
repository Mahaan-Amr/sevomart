import { rebuildDiscoveryFollowerCountProjection } from "./project-follower-count";
import { rebuildDiscoveryPublicFeedProjection } from "./project-public-feed";

type RebuildDependencies = {
  rebuildFollowerCount: (
    databaseUrl: string,
  ) => Promise<{ replayedEventCount: number }>;
  rebuildPublicFeed: (databaseUrl: string) => Promise<{ health: { healthy: boolean } }>;
};

const defaultDependencies: RebuildDependencies = {
  rebuildFollowerCount: rebuildDiscoveryFollowerCountProjection,
  rebuildPublicFeed: rebuildDiscoveryPublicFeedProjection,
};

export async function rebuildDiscoveryProjections(
  databaseUrl: string,
  dependencies: RebuildDependencies = defaultDependencies,
) {
  const followerCount = await dependencies.rebuildFollowerCount(databaseUrl);
  const publicFeed = await dependencies.rebuildPublicFeed(databaseUrl);
  return { followerCount, publicFeed };
}
