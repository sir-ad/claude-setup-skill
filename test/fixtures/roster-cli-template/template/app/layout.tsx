import Link from 'next/link';

export default function Layout({ children }: { children: unknown }) {
  return (
    <div>
      <Link href="/">home</Link>
      {children as never}
    </div>
  );
}
