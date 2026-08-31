export default function JournalSkeleton() {
  return (
    <div
      aria-busy="true"
      aria-label="日記載入中"
      className="mx-auto w-full max-w-md space-y-4 px-4 pt-6 pb-10"
    >
      <div className="h-16 animate-pulse rounded-3xl bg-paper-deep" />
      <div className="h-32 animate-pulse rounded-3xl bg-paper-deep" />
      <div className="h-64 animate-pulse rounded-3xl bg-paper-deep" />
      <div className="h-56 animate-pulse rounded-3xl bg-paper-deep" />
    </div>
  );
}
