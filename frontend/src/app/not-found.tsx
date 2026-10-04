import Link from "next/link";
import { Button, EmptyState } from "@/components/ui";

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center px-6 py-16">
      <EmptyState
        title="Page not found"
        description="The page you're looking for doesn't exist or may have been moved."
      />
      <div className="mt-6 flex gap-3">
        <Button asChild>
          <Link href="/">Go to Dashboard</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/login">Go to Login</Link>
        </Button>
      </div>
    </div>
  );
}
