'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api.js';
import { PageSection } from '@/components/page-section';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DetailList } from '@/components/detail-list';

export default function UserAccessPage() {
  const [items, setItems] = useState([]);

  useEffect(() => {
    apiFetch('/api/user/access')
      .then((r) => r.json())
      .then((a) => {
        if (a.error) throw new Error(a.error);
        const e = a.entry;
        if (!e) {
          setItems([['Status', 'No invitation record found']]);
          return;
        }
        setItems([
          ['Email', e.email || '—'],
          ['Username', e.username ? `@${e.username}` : '—'],
          ['Status', e.status || '—'],
          ['Invited', e.invitedAt || '—'],
          ['First login', e.firstLoginAt || '—'],
          ['Last seen', e.lastSeen || '—'],
          ['Notes', e.notes || '—'],
        ]);
      })
      .catch(() => setItems([['Status', 'Failed to load']]));
  }, []);

  return (
    <PageSection title="Access">
      <Card>
        <CardHeader>
          <CardTitle>Invitation & access</CardTitle>
        </CardHeader>
        <CardContent>
          <DetailList items={items} />
        </CardContent>
      </Card>
    </PageSection>
  );
}
