'use client';

import Link from 'next/link';
import { PageSection } from '@/components/page-section';
import { Button } from '@/components/ui/button';

export default function AdminHomePage() {
  return (
    <PageSection title="Admin">
      <div className="card">
        <h2>Admin</h2>
        <p className="lead">
          Manage users, audit logs, token usage, and the internal knowledge base. The legacy panel has additional
          settings (Telegram, engine, memory, and more).
        </p>
        <div className="row">
          <Button asChild>
            <Link href="/admin/knowledge">Knowledge base (RAG)</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/admin/legacy">Open full control panel</Link>
          </Button>
        </div>
      </div>
    </PageSection>
  );
}
