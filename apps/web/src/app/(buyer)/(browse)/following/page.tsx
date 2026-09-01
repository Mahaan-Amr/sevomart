import { FeedView } from "../feed-view";

export default function FollowingPage() {
  return (
    <>
      <h1>دنبال‌شده‌ها</h1>
      <FeedView kind="following" />
    </>
  );
}
