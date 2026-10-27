// While a page loads: a title, a card and a few rows in grey, shimmering
// (.skeleton, app.css), instead of a blank screen.
export default function Loading() {
  return (
    <div aria-busy="true" className="mx-auto max-w-[1240px] px-4 pt-6 sm:px-6 sm:pt-10">
      <div className="skeleton h-10 w-2/3 max-w-[420px]" />
      <div className="skeleton mt-6 h-20 w-full rounded-[22px]" />
      <div className="skeleton mt-3 h-44 w-full rounded-[28px]" />
      <div className="mt-3 grid grid-cols-4 gap-3">
        {Array.from({ length: 8 }, (_, i) => <div key={i} className="skeleton aspect-square rounded-2xl" />)}
      </div>
    </div>
  );
}
