'use client';

import { useEffect, useMemo, useState } from 'react';
import { apiJson } from '@/lib/api.js';
import { PageSection } from '@/components/page-section';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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

const WEB_BOT_KEY = 'web';

function botTabLabel(bot) {
  if (bot?.isWeb) return 'Web account';
  const un = bot?.username ? `@${String(bot.username).replace(/^@+/, '')}` : '';
  return un || `Bot ${bot?.botId ?? '?'}`;
}

export default function UserMemoryPage() {
  const [activeTab, setActiveTab] = useState('bot');
  const [timezones, setTimezones] = useState([]);
  const [bots, setBots] = useState([]);
  const [currentBotKey, setCurrentBotKey] = useState(WEB_BOT_KEY);
  const [sessions, setSessions] = useState([]);
  const [allSessions, setAllSessions] = useState([]);
  const [sessionUserId, setSessionUserId] = useState(null);
  const [primaryUserId, setPrimaryUserId] = useState(null);
  const [profile, setProfile] = useState(EMPTY_PROFILE);
  const [persona, setPersona] = useState(EMPTY_PERSONA);
  const [records, setRecords] = useState([]);
  const [souls, setSouls] = useState([]);
  const [status, setStatus] = useState('');
  const [copyFrom, setCopyFrom] = useState('');
  const [copyFromPersona, setCopyFromPersona] = useState('');

  async function loadTimezones() {
    const r = await apiJson('/api/user/timezones');
    setTimezones(r.timezones || []);
  }

  function memoryQuery(targetId, botKey) {
    const params = new URLSearchParams();
    if (targetId != null && targetId !== '') {
      params.set('sessionUserId', String(targetId));
    }
    if (botKey && botKey !== WEB_BOT_KEY) {
      params.set('botId', String(botKey));
    }
    const q = params.toString();
    return q ? `?${q}` : '';
  }

  async function loadBots() {
    const r = await apiJson('/api/user/memory/bots');
    setPrimaryUserId(r.primaryUserId ?? null);
    const telegramBots = Array.isArray(r.bots) ? r.bots : [];
    setBots([{ isWeb: true, botId: null }, ...telegramBots]);
  }

  async function loadSessionsForBot(botKey) {
    const q =
      botKey && botKey !== WEB_BOT_KEY
        ? `?botId=${encodeURIComponent(botKey)}`
        : '?botId=web';
    const r = await apiJson(`/api/user/memory/sessions${q}`);
    const list = r.sessions || [];
    setSessions(list);
    return list;
  }

  async function loadAllSessions() {
    const r = await apiJson('/api/user/sessions');
    setAllSessions(r.sessions || []);
    return r.sessions || [];
  }

  async function loadMemory(targetId, botKey) {
    const r = await apiJson(`/api/user/memory${memoryQuery(targetId, botKey)}`);
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
    setSessionUserId(r.sessionUserId ?? null);
    if (r.primaryUserId != null) setPrimaryUserId(r.primaryUserId);
  }

  async function loadSouls(botKey) {
    const q =
      botKey && botKey !== WEB_BOT_KEY
        ? `?botId=${encodeURIComponent(botKey)}`
        : '';
    const r = await apiJson(`/api/user/souls${q}`);
    setSouls(r.souls || []);
  }

  async function refresh(targetId, botKey = currentBotKey) {
    setStatus('');
    try {
      const list = await loadSessionsForBot(botKey);
      const pick =
        targetId != null && list.some((s) => s.userId === Number(targetId))
          ? Number(targetId)
          : list[0]?.userId ?? primaryUserId;
      await Promise.all([loadMemory(pick, botKey), loadSouls(botKey), loadAllSessions()]);
      setSessionUserId(pick ?? null);
    } catch (e) {
      setStatus(e.message);
    }
  }

  useEffect(() => {
    loadTimezones().catch((e) => setStatus(e.message));
    loadBots()
      .then(() => refresh(null, WEB_BOT_KEY))
      .catch((e) => setStatus(e.message));
  }, []);

  function switchBot(botKey) {
    if (botKey === currentBotKey) return;
    setCurrentBotKey(botKey);
    setCopyFrom('');
    setCopyFromPersona('');
    refresh(null, botKey).catch((e) => setStatus(e.message));
  }

  function switchSession(nextId) {
    const n = Number(nextId);
    if (!Number.isFinite(n) || n === sessionUserId) return;
    setStatus('');
    loadMemory(n, currentBotKey)
      .then(() => loadSouls(currentBotKey))
      .catch((e) => setStatus(e.message));
  }

  async function saveProfile() {
    setStatus('Saving…');
    await apiJson(`/api/user/memory${memoryQuery(sessionUserId, currentBotKey)}`, {
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
    });
    setStatus('Saved.');
    await refresh(sessionUserId, currentBotKey);
  }

  async function savePersona() {
    setStatus('Saving…');
    await apiJson(`/api/user/memory${memoryQuery(sessionUserId, currentBotKey)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ botPersona: persona }),
    });
    setStatus('Saved.');
    await refresh(sessionUserId, currentBotKey);
  }

  async function copyProfileFrom() {
    if (!copyFrom || sessionUserId == null) return;
    const from = Number(copyFrom);
    const to = Number(sessionUserId);
    if (!Number.isFinite(from) || from === to) return;
    if (
      !confirm(
        `Copy memory from session ${from} into ${to}? Existing memory for this session will be replaced.`
      )
    ) {
      return;
    }
    setStatus('Copying…');
    await apiJson('/api/user/memory/copy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fromUserId: Number(copyFrom), toUserId: sessionUserId }),
    });
    setStatus('Copied.');
    await refresh(sessionUserId, currentBotKey);
  }

  async function removeRecord(recordId) {
    if (sessionUserId == null) return;
    const id = Number(recordId);
    if (!Number.isFinite(id)) return;
    if (!confirm(`Delete saved table row #${id}?`)) return;
    setStatus('Deleting…');
    const params = new URLSearchParams({ sessionUserId: String(sessionUserId) });
    if (currentBotKey && currentBotKey !== WEB_BOT_KEY) {
      params.set('botId', String(currentBotKey));
    }
    await apiJson(`/api/user/memory/records/delete?${params}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionUserId, id }),
    });
    setStatus('Row deleted.');
    const mem = await apiJson(`/api/user/memory${memoryQuery(sessionUserId, currentBotKey)}`);
    setRecords(mem.records || []);
  }

  async function copyPersonaFrom() {
    if (!copyFromPersona || sessionUserId == null) return;
    const from = Number(copyFromPersona);
    const to = Number(sessionUserId);
    if (!Number.isFinite(from) || from === to) return;
    if (
      !confirm(
        `Copy assistant identity from session ${from} into ${to}? Existing identity for this session will be replaced.`
      )
    ) {
      return;
    }
    setStatus('Copying…');
    await apiJson('/api/user/memory/copy-bot-persona', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fromUserId: Number(copyFromPersona), toUserId: sessionUserId }),
    });
    setStatus('Copied.');
    await refresh(sessionUserId, currentBotKey);
  }

  const otherSessions = useMemo(
    () => allSessions.filter((s) => s.userId !== sessionUserId),
    [allSessions, sessionUserId]
  );

  const onlyWebBot = bots.length <= 1 && bots[0]?.isWeb;

  return (
    <PageSection title="Memory & bot persona" neuralBgId="neuralBgToggleData">
      <div className="toolbar mem-toolbar mem-toolbar-session">
        <div className="mem-toolbar-grid">
          <div className="mem-bot-select-wrap">
            <div className="session-select-row">
              <Label htmlFor="memBotSelect">Bot</Label>
              <select
                id="memBotSelect"
                className="sena-field chat-session-select"
                value={currentBotKey}
                onChange={(e) => switchBot(e.target.value)}
                aria-label="Select bot"
              >
                {bots.map((b) => {
                  const key = b.isWeb ? WEB_BOT_KEY : String(b.botId);
                  return (
                    <option key={key} value={key}>
                      {botTabLabel(b)}
                    </option>
                  );
                })}
              </select>
            </div>
            {onlyWebBot ? (
              <p className="hint text-sm" style={{ marginTop: '0.35rem' }}>
                Connect your bot token on the Telegram tab to see bot sessions here.
              </p>
            ) : null}
          </div>
          <div className="mem-bot-select-wrap">
            <div className="session-select-row">
              <Label htmlFor="memSessionSelect">Session</Label>
              <select
                id="memSessionSelect"
                className="sena-field chat-session-select"
                value={sessionUserId ?? ''}
                onChange={(e) => switchSession(e.target.value)}
              >
                {sessions.length === 0 ? (
                  <option value="">
                    {currentBotKey === WEB_BOT_KEY
                      ? 'Web account'
                      : 'No Telegram sessions yet — approve users and chat on the bot'}
                  </option>
                ) : (
                  sessions.map((s) => (
                    <option key={s.userId} value={s.userId}>
                      {s.label}
                    </option>
                  ))
                )}
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
                    placeholder="e.g. SENA"
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
                  <select
                    className="sena-field"
                    value={persona.gender || ''}
                    onChange={(e) => setPersona((p) => ({ ...p, gender: e.target.value }))}
                  >
                    <option value="">—</option>
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                  </select>
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
                    className="sena-field chat-session-select"
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
              <div className="mem-copy-row mem-bot-copy-row">
                <Label>Copy assistant identity from</Label>
                <select
                  className="sena-field chat-session-select"
                  value={copyFromPersona}
                  onChange={(e) => setCopyFromPersona(e.target.value)}
                  disabled={!otherSessions.length}
                >
                  <option value="">
                    {otherSessions.length
                      ? '— Pick another session —'
                      : '— No other sessions yet —'}
                  </option>
                  {otherSessions.map((s) => (
                    <option key={s.userId} value={s.userId}>
                      {s.label}
                    </option>
                  ))}
                </select>
                <Button
                  variant="outline"
                  disabled={!copyFromPersona}
                  onClick={() => copyPersonaFrom().catch((e) => setStatus(e.message))}
                >
                  Copy into current session
                </Button>
              </div>
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
                    className="sena-field chat-session-select"
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
                  <select
                    className="sena-field"
                    value={profile.gender || ''}
                    onChange={(e) => setProfile((f) => ({ ...f, gender: e.target.value }))}
                  >
                    <option value="">—</option>
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
                <div>
                  <Label>Age</Label>
                  <select
                    className="sena-field"
                    value={profile.age || ''}
                    onChange={(e) => setProfile((f) => ({ ...f, age: e.target.value }))}
                  >
                    <option value="">—</option>
                    {AGE_BUCKETS.map((a) => (
                      <option key={a} value={a}>
                        {a}
                      </option>
                    ))}
                  </select>
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
              <div className="mem-copy-row">
                <Label>Copy memory from</Label>
                <select
                  className="sena-field chat-session-select"
                  value={copyFrom}
                  onChange={(e) => setCopyFrom(e.target.value)}
                  disabled={!otherSessions.length}
                >
                  <option value="">
                    {otherSessions.length
                      ? '— Pick another session —'
                      : '— No other sessions yet —'}
                  </option>
                  {otherSessions.map((s) => (
                    <option key={s.userId} value={s.userId}>
                      {s.label}
                    </option>
                  ))}
                </select>
                <Button
                  variant="outline"
                  disabled={!copyFrom}
                  onClick={() => copyProfileFrom().catch((e) => setStatus(e.message))}
                >
                  Copy into current session
                </Button>
              </div>
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
                    <TableHead className="w-[1%]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {records.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="hint">
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
                        <TableCell>
                          <Button
                            type="button"
                            variant="outline"
                            className="text-destructive hover:text-destructive"
                            onClick={() =>
                              removeRecord(r.id).catch((e) => setStatus(e.message))
                            }
                          >
                            Remove
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
                              const key =
                                s.botId != null && s.botId !== '' ? String(s.botId) : WEB_BOT_KEY;
                              setActiveTab('session');
                              if (key !== currentBotKey) {
                                setCurrentBotKey(key);
                                refresh(s.userId, key).catch((e) => setStatus(e.message));
                              } else {
                                switchSession(s.userId);
                              }
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
