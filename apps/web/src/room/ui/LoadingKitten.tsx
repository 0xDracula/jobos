export function LoadingKitten() {
  return (
    <div role="status" aria-label="Loading" className="absolute inset-0 grid place-items-center">
      <svg viewBox="0 0 120 80" className="w-32 text-[#f2a65a]" aria-hidden>
        <style>{`
          @keyframes kitten-stretch { 0%, 100% { transform: scaleX(1) scaleY(1); } 50% { transform: scaleX(1.18) scaleY(0.88); } }
          @keyframes kitten-tail { 0%, 100% { transform: rotate(0deg); } 50% { transform: rotate(-18deg); } }
          .k-body { transform-origin: 60px 60px; animation: kitten-stretch 1.6s ease-in-out infinite; }
          .k-tail { transform-origin: 24px 52px; animation: kitten-tail 1.6s ease-in-out infinite; }
          @media (prefers-reduced-motion: reduce) { .k-body, .k-tail { animation: none; } }
        `}</style>
        <g className="k-body" fill="currentColor">
          <ellipse cx="58" cy="54" rx="30" ry="14" />
          <circle cx="88" cy="44" r="12" />
          <path d="M80 36 l3 -11 l6 9 z M92 33 l6 -9 l2 11 z" />
          <rect x="34" y="60" width="7" height="12" rx="3.5" />
          <rect x="74" y="60" width="7" height="12" rx="3.5" />
          <circle cx="92" cy="44" r="1.6" fill="#3b2f3f" />
          <circle cx="86" cy="44" r="1.6" fill="#3b2f3f" />
        </g>
        <path className="k-tail" d="M28 52 q-18 -4 -14 -24" stroke="currentColor" strokeWidth="6" strokeLinecap="round" fill="none" />
      </svg>
    </div>
  );
}
