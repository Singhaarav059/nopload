// While a tool's page loads (a tap from the home or the Tools sheet): its
// shape in grey, shimmering (.skeleton, app.css), instead of a blank screen.
export default function Loading() {
  return (
    <div aria-busy="true" className="mx-auto max-w-[760px] px-4 pt-6 sm:px-6 sm:pt-10">
      <div className="flex items-center justify-center gap-4">
        <div className="skeleton h-14 w-14 rounded-2xl" />
        <div className="skeleton h-9 w-48" />
      </div>
      <div className="skeleton mx-auto mt-6 h-12 w-full max-w-[520px] rounded-full" />
      <div className="skeleton mt-6 h-[52vh] min-h-[280px] w-full rounded-[28px]" />
    </div>
  );
}
