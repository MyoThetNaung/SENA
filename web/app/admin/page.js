'use client';

import Link from 'next/link';
import { PageSection } from '@/components/page-section';
import { Button } from '@/components/ui/button';

export default function AdminHomePage() {
  return (
    <PageSection title="Admin">
      <div className="card">
        <h2>Control panel</h2>
        <p className="lead">
          The full SENA admin UI (settings, bots, users, memory, and more) is available in the legacy panel while
          features are migrated to this shell.
        </p>
        <div className="row">
          <Button asChild>
            <Link href="/admin/legacy">Open full control panel</Link>
          </Button>
        </div>
      </div>
    </PageSection>
  );
}
