import Link from "next/link";

export default function NotFound() {
  return (
    <div className="grid place-items-center gap-4 py-24 text-center">
      <h1 className="font-display text-[32px] font-semibold">Page not found</h1>
      <Link href="/" className="font-bold text-accent-strong hover:underline">
        Home
      </Link>
    </div>
  );
}
