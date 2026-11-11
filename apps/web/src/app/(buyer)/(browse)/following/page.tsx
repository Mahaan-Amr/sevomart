import { FeedView } from "../feed-view";
import { FeedTabs } from "../feed-tabs";

export default function FollowingPage() {
  return (
    <>
      <h1>دنبال‌شده‌ها</h1>
      <FeedTabs />
      <FeedView kind="following" />
    </>
  );
}
