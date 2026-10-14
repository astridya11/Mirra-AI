import ShowcaseNav from "@/src/components/showcase/ShowcaseNav";
import ShowcaseFooter from "@/src/components/showcase/ShowcaseFooter";

export default function ShowcaseLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <ShowcaseNav />
      <main className="flex-1">{children}</main>
      <ShowcaseFooter />
    </div>
  );
}
