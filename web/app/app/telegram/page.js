'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api.js';
import { PageSection } from '@/components/page-section';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DetailList } from '@/components/detail-list';

export default function UserTelegramPage() {
  const [items, setItems] = useState([]);

  useEffect(() => {
    apiFetch('/api/user/telegram')
      .then((r) => r.json())
      .then((t) => {
        if (t.error) throw new Error(t.error);
        if (!t.linked) {
          setItems([['Status', 'Not linked to Telegram yet']]);
          return;
        }
        setItems([
          ['Username', t.username ? `@${t.username}` : '—'],
          ['Telegram user id', t.telegramUserId ?? '—'],
          ['Email', t.email || '—'],
          ['Status', t.status || '—'],
          ['Last seen', t.lastSeen || '—'],
        ]);
      })
      .catch(() => setItems([['Status', 'Failed to load']]));
  }, []);

  return (
    <PageSection title="Telegram">
      <Card>
        <CardHeader>
          <CardTitle>Your Telegram link</CardTitle>
        </CardHeader>
        <CardContent>
          <DetailList items={items} />
        </CardContent>
      </Card>
    </PageSection>
  );
}
