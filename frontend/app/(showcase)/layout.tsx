import { TopNav } from "@/src/components/showcase/ui";
import ShowcaseFooter from "@/src/components/showcase/ShowcaseFooter";

export default function ShowcaseLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-surface">
      <TopNav />
      <main className="flex-1">{children}</main>
      <ShowcaseFooter />
    </div>
  );
}
