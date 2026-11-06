// Placeholder rows shaped like real tender rows, shown while the first load is in flight.
export function SkeletonRows({ count = 5 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <div className="sk-row" aria-hidden="true" key={i}>
          <span className="sk ring-sk" />
          <div>
            <span className="sk" style={{ height: 16, width: '85%' }} />
            <span className="sk" style={{ height: 12, width: '45%' }} />
          </div>
          <div>
            <span className="sk" style={{ height: 18, width: 70 }} />
            <span className="sk" style={{ height: 12, width: 50 }} />
          </div>
          <div>
            <span className="sk" style={{ height: 22, width: 56, borderRadius: 20 }} />
            <span className="sk" style={{ height: 12, width: '90%' }} />
          </div>
        </div>
      ))}
    </>
  );
}
