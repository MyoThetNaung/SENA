'use client';

import { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '@/lib/api.js';
import { PageSection } from '@/components/page-section';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const EMPTY_PROFILE = {
  timezone: 'Asia/Rangoon',
  display_name: '',
  gender: '',
  age: '',
  addressUserEn: '',
  addressUserMy: '',
  whoAmI: '',
  extra: '',
  memorySummary: '',
};

const EMPTY_PERSONA = {
  displayName: '',
  displayNameMy: '',
  gender: '',
  style: '',
  role: '',
};

const AGE_BUCKETS = ['Under 13', '13-17', '18-24', '25-34', '35-44', '45-54', '55-64', '65+'];

export default function UserMemoryPage() {
  const [activeTab, setActiveTab] = useState('bot');
  const [timezones, setTimezones] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [sessionUserId, setSessionUserId] = useState(null);
  const [profile, setProfile] = useState(EMPTY_PROFILE);
  const [persona, setPersona] = useState(EMPTY_PERSONA);
  const [records, setRecords] = useState([]);
  const [souls, setSouls] = useState([]);
  const [status, setStatus] = useState('');
  const [copyFrom, setCopyFrom] = useState('');
  const [copyFromPersona, setCopyFromPersona] = useState('');

  async function loadTimezones() {
    const r = await apiFetch('/api/user/timezones').then((x) => x.json());
    setTimezones(r.timezones || []);
  }

  async function loadMemory(targetId) {
    const qs = targetId != null ? `?sessionUserId=${encodeURIComponent(targetId)}` : '';
    const r = await apiFetch(`/api/user/memory${qs}`).then((x) => x.json());
    if (r.error) throw new Error(r.error);
    const soul = r.soul || {};
    const prof = soul.preferences?.profile || {};
    setProfile({
      timezone: prof.timezone || 'Asia/Rangoon',
      display_name: soul.display_name || '',
      gender: prof.gender || '',
      age: prof.age || '',
      addressUserEn: prof.addressUserEn || '',
      addressUserMy: prof.addressUserMy || '',
      whoAmI: prof.whoAmI || '',
      extra: prof.extra || '',
      memorySummary: prof.memorySummary || '',
    });
    const bp = soul.preferences?.botPersona || {};
    setPersona({
      displayName: bp.displayName || '',
      displayNameMy: bp.displayNameMy || '',
      gender: bp.gender || '',
      style: bp.style || '',
      role: bp.role || '',
    });
    setRecords(r.records || []);
    setSessions(r.sessions || []);
    setSessionUserId(r.sessionUserId ?? null);
  }

  async function loadSouls() {
    const r = await apiFetch('/api/user/souls').then((x) => x.json());
    if (r.error) throw new Error(r.error);
    setSouls(r.souls || []);
  }

  async function refresh(targetId) {
    setStatus('');
    try {
      await Promise.all([loadMemory(targetId), loadSouls()]);
    } catch (e) {
      setStatus(e.message);
    }
  }

  useEffect(() => {
    loadTimezones().catch((e) => setStatus(e.message));
    refresh().catch((e) => setStatus(e.message));
  }, []);

  function switchSession(nextId) {
    const n = Number(nextId);
    if (!Number.isFinite(n) || n === sessionUserId) return;
    refresh(n).catch((e) => setStatus(e.message));
  }

  async function saveProfile() {
    setStatus('Saving…');
    const r = await apiFetch(
      `/api/user/memory?sessionUserId=${encodeURIComponent(sessionUserId ?? '')}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          display_name: profile.display_name,
          profile: {
            timezone: profile.timezone,
            gender: profile.gender,
            age: profile.age,
            addressUserEn: profile.addressUserEn,
            addressUserMy: profile.addressUserMy,
            whoAmI: profile.whoAmI,
            extra: profile.extra,
            memorySummary: profile.memorySummary,
          },
        }),
      }
    );
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Save failed');
    setStatus('Saved.');
    await refresh(sessionUserId);
  }

  async function savePersona() {
    setStatus('Saving…');
    const r = await apiFetch(
      `/api/user/memory?sessionUserId=${encodeURIComponent(sessionUserId ?? '')}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ botPersona: persona }),
      }
    );
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Save failed');
    setStatus('Saved.');
    await refresh(sessionUserId);
  }

  async function copyProfileFrom() {
    if (!copyFrom) return;
    setStatus('Copying…');
    const r = await apiFetch('/api/user/memory/copy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fromUserId: Number(copyFrom), toUserId: sessionUserId }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Copy failed');
    setStatus('Copied.');
    await refresh(sessionUserId);
  }

  async function copyPersonaFrom() {
    if (!copyFromPersona) return;
    setStatus('Copying…');
    const r = await apiFetch('/api/user/memory/copy-bot-persona', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fromUserId: Number(copyFromPersona), toUserId: sessionUserId }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Copy failed');
    setStatus('Copied.');
    await refresh(sessionUserId);
  }

  const otherSessions = useMemo(
    () => sessions.filter((s) => s.userId !== sessionUserId),
    [sessions, sessionUserId]
  );

  return (
    <PageSection title="Memory & bot persona">
      <div className="toolbar mem-toolbar mem-toolbar-session">
        <div className="mem-toolbar-grid">
          <div className="session-select-wrap">
            <div className="session-select-row">
              <Label htmlFor="memSessionSelect">Session</Label>
              <select
                id="memSessionSelect"
                className="chat-session-select"
                value={sessionUserId ?? ''}
                onChange={(e) => switchSession(e.target.value)}
              >
                {sessions.map((s) => (
                  <option key={s.userId} value={s.userId}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>

      <div className="mem-hnav" aria-label="Memory sections">
        <ul className="mem-stabnav" role="tablist">
          <li role="presentation">
            <a
              href="#bot"
              role="tab"
              aria-selected={activeTab === 'bot'}
              className={`mem-stab-link${activeTab === 'bot' ? ' active' : ''}`}
              onClick={(e) => {
                e.preventDefault();
                setActiveTab('bot');
              }}
            >
              Assistant identity
            </a>
          </li>
          <li role="presentation">
            <a
              href="#session"
              role="tab"
              aria-selected={activeTab === 'session'}
              className={`mem-stab-link${activeTab === 'session' ? ' active' : ''}`}
              onClick={(e) => {
                e.preventDefault();
                setActiveTab('session');
              }}
            >
              User memory by session
            </a>
          </li>
          <li role="presentation">
            <a
              href="#souls"
              role="tab"
              aria-selected={activeTab === 'souls'}
              className={`mem-stab-link${activeTab === 'souls' ? ' active' : ''}`}
              onClick={(e) => {
                e.preventDefault();
                setActiveTab('souls');
              }}
            >
              All soul rows (overview)
            </a>
          </li>
        </ul>
      </div>

      {activeTab === 'bot' ? (
        <div className="mem-subpane">
          <Card className="mem-bot-card">
            <CardHeader>
              <CardTitle>Assistant identity</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="mem-grid mem-bot-grid">
                <div>
                  <Label>Bot display name</Label>
                  <Input
                    value={persona.displayName}
                    placeholder="e.g. AI_AGENT_NG2"
                    onChange={(e) =>
                      setPersona((p) => ({ ...p, displayName: e.target.value }))
                    }
                  />
                </div>
                <div>
                  <Label>Bot name (Myanmar)</Label>
                  <Input
                    value={persona.displayNameMy}
                    placeholder="ဥပမာ — ဆီနာ"
                    onChange={(e) =>
                      setPersona((p) => ({ ...p, displayNameMy: e.target.value }))
                    }
                  />
                </div>
                <div>
                  <Label>Bot gender (persona)</Label>
                  <Select
                    value={persona.gender || '__none'}
                    onValueChange={(v) =>
                      setPersona((p) => ({ ...p, gender: v === '__none' ? '' : v }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="—" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none">—</SelectItem>
                      <SelectItem value="Male">Male</SelectItem>
                      <SelectItem value="Female">Female</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="mem-span2">
                  <Label>Reply style</Label>
                  <Input
                    value={persona.style}
                    placeholder="e.g. concise, friendly"
                    onChange={(e) => setPersona((p) => ({ ...p, style: e.target.value }))}
                  />
                </div>
                <div className="mem-span2">
                  <Label>What the bot does / role</Label>
                  <Textarea
                    rows={6}
                    value={persona.role}
                    placeholder="Describe the assistant’s job, boundaries, and behavior (multiple lines)."
                    onChange={(e) => setPersona((p) => ({ ...p, role: e.target.value }))}
                  />
                </div>
                <div className="mem-span2">
                  <Label>User timezone (this session)</Label>
                  <select
                    className="chat-session-select"
                    value={profile.timezone}
                    onChange={(e) => setProfile((f) => ({ ...f, timezone: e.target.value }))}
                  >
                    {timezones.map((tz) => (
                      <option key={tz} value={tz}>
                        {tz}
                      </option>
                    ))}
                  </select>
                  <p className="hint">
                    Used for “today”, calendar, and saved dates. Same as the toolbar field above.
                  </p>
                </div>
              </div>
              <div className="mem-actions mem-bot-actions">
                <Button onClick={() => savePersona().catch((e) => setStatus(e.message))}>
                  Save for this session
                </Button>
                <Button
                  variant="outline"
                  onClick={() => saveProfile().catch((e) => setStatus(e.message))}
                >
                  Save timezone change
                </Button>
              </div>
              {otherSessions.length ? (
                <div className="mem-copy-row mem-bot-copy-row">
                  <Label>Copy assistant identity from</Label>
                  <select
                    className="chat-session-select"
                    value={copyFromPersona}
                    onChange={(e) => setCopyFromPersona(e.target.value)}
                  >
                    <option value="">— Pick another session —</option>
                    {otherSessions.map((s) => (
                      <option key={s.userId} value={s.userId}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                  <Button
                    variant="outline"
                    onClick={() => copyPersonaFrom().catch((e) => setStatus(e.message))}
                  >
                    Copy into current session
                  </Button>
                </div>
              ) : null}
              {status ? <p className="hint">{status}</p> : null}
            </CardContent>
          </Card>
        </div>
      ) : null}

      {activeTab === 'session' ? (
        <div className="mem-subpane">
          <Card className="mem-user-card">
            <CardHeader>
              <CardTitle>User memory by session</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="mem-grid">
                <div>
                  <Label>Display name</Label>
                  <Input
                    value={profile.display_name}
                    placeholder="Name to use in replies"
                    onChange={(e) =>
                      setProfile((f) => ({ ...f, display_name: e.target.value }))
                    }
                  />
                </div>
                <div>
                  <Label>Timezone</Label>
                  <select
                    className="chat-session-select"
                    value={profile.timezone}
                    onChange={(e) =>
                      setProfile((f) => ({ ...f, timezone: e.target.value }))
                    }
                  >
                    {timezones.map((tz) => (
                      <option key={tz} value={tz}>
                        {tz}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label>Gender</Label>
                  <Select
                    value={profile.gender || '__none'}
                    onValueChange={(v) =>
                      setProfile((f) => ({ ...f, gender: v === '__none' ? '' : v }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="—" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none">—</SelectItem>
                      <SelectItem value="Male">Male</SelectItem>
                      <SelectItem value="Female">Female</SelectItem>
                      <SelectItem value="Other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Age</Label>
                  <Select
                    value={profile.age || '__none'}
                    onValueChange={(v) =>
                      setProfile((f) => ({ ...f, age: v === '__none' ? '' : v }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="—" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none">—</SelectItem>
                      {AGE_BUCKETS.map((a) => (
                        <SelectItem key={a} value={a}>
                          {a}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Call me (English)</Label>
                  <Input
                    value={profile.addressUserEn}
                    placeholder="e.g. friend, sir, မင်း"
                    onChange={(e) =>
                      setProfile((f) => ({ ...f, addressUserEn: e.target.value }))
                    }
                  />
                </div>
                <div>
                  <Label>Call me (Myanmar)</Label>
                  <Input
                    value={profile.addressUserMy}
                    placeholder="ဥပမာ — ညီလေး၊ မင်း၊ အစ်ကို"
                    onChange={(e) =>
                      setProfile((f) => ({ ...f, addressUserMy: e.target.value }))
                    }
                  />
                </div>
                <div className="mem-span2">
                  <Label>Who I am</Label>
                  <Textarea
                    rows={2}
                    value={profile.whoAmI}
                    placeholder="Short self-description"
                    onChange={(e) => setProfile((f) => ({ ...f, whoAmI: e.target.value }))}
                  />
                </div>
                <div className="mem-span2">
                  <Label>Other notes</Label>
                  <Textarea
                    rows={2}
                    value={profile.extra}
                    placeholder="Anything else to remember"
                    onChange={(e) => setProfile((f) => ({ ...f, extra: e.target.value }))}
                  />
                </div>
                <div className="mem-span2">
                  <Label>Conversation memory</Label>
                  <Textarea
                    rows={8}
                    value={profile.memorySummary}
                    placeholder="Summary appears after you chat; editable anytime."
                    onChange={(e) =>
                      setProfile((f) => ({ ...f, memorySummary: e.target.value }))
                    }
                  />
                </div>
              </div>
              <div className="mem-actions">
                <Button onClick={() => saveProfile().catch((e) => setStatus(e.message))}>
                  Save session memory
                </Button>
              </div>
              {otherSessions.length ? (
                <div className="mem-copy-row">
                  <Label>Copy memory from</Label>
                  <select
                    className="chat-session-select"
                    value={copyFrom}
                    onChange={(e) => setCopyFrom(e.target.value)}
                  >
                    <option value="">— Pick another session —</option>
                    {otherSessions.map((s) => (
                      <option key={s.userId} value={s.userId}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                  <Button
                    variant="outline"
                    onClick={() => copyProfileFrom().catch((e) => setStatus(e.message))}
                  >
                    Copy into current session
                  </Button>
                </div>
              ) : null}
              {status ? <p className="hint">{status}</p> : null}
            </CardContent>
          </Card>

          <Card className="mem-records-card">
            <CardHeader>
              <CardTitle>Saved table rows (this session)</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Id</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Title</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {records.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="hint">
                        No rows yet.
                      </TableCell>
                    </TableRow>
                  ) : (
                    records.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell>{r.id}</TableCell>
                        <TableCell>{r.record_type}</TableCell>
                        <TableCell>{r.record_date || '—'}</TableCell>
                        <TableCell>{r.title || '—'}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {activeTab === 'souls' ? (
        <div className="mem-subpane">
          <Card>
            <CardHeader>
              <CardTitle>All soul rows (overview)</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User ID</TableHead>
                    <TableHead>Session</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Summary preview</TableHead>
                    <TableHead>Timezone</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {souls.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="hint">
                        No soul rows yet.
                      </TableCell>
                    </TableRow>
                  ) : (
                    souls.map((s) => (
                      <TableRow key={s.userId}>
                        <TableCell>{s.userId}</TableCell>
                        <TableCell>{s.label}</TableCell>
                        <TableCell>{s.displayName || '—'}</TableCell>
                        <TableCell>{s.summaryPreview || '—'}</TableCell>
                        <TableCell>{s.timezone || '—'}</TableCell>
                        <TableCell>
                          <Button
                            variant="outline"
                            onClick={() => {
                              setActiveTab('session');
                              switchSession(s.userId);
                            }}
                          >
                            Edit
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </PageSection>
  );
}
