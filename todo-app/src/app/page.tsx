import { AuthGate } from "@/components/AuthGate";
import { ClientOnly } from "@/components/ClientOnly";

export default function Home() {
  return (
    <ClientOnly fallback={<p className="empty loading">불러오는 중…</p>}>
      <AuthGate />
    </ClientOnly>
  );
}
