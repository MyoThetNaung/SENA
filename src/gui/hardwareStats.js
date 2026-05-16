import * as os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const EXEC_OPTS = { timeout: 5000, maxBuffer: 1024 * 1024, encoding: 'utf8' };
let macProfileCache = { at: 0, value: null };

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function sampleCpuAggregate() {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;
  for (const cpu of cpus) {
    idle += cpu.times.idle;
    for (const k of Object.keys(cpu.times)) {
      total += cpu.times[k];
    }
  }
  return { idle, total };
}

async function measureCpuPercent(intervalMs) {
  const s1 = sampleCpuAggregate();
  await sleep(intervalMs);
  const s2 = sampleCpuAggregate();
  const idleDiff = s2.idle - s1.idle;
  const totalDiff = s2.total - s1.total;
  if (totalDiff <= 0) return null;
  const p = 100 * (1 - idleDiff / totalDiff);
  return Math.round(Math.max(0, Math.min(100, p)) * 10) / 10;
}

function parseSystemProfilerValue(stdout, label) {
  const re = new RegExp(`^\\s*${label}:\\s*(.+?)\\s*$`, 'im');
  return stdout.match(re)?.[1]?.trim() || null;
}

async function execText(bin, args, opts = EXEC_OPTS) {
  const { stdout } = await execFileAsync(bin, args, opts);
  return String(stdout || '');
}

async function getMacProfile() {
  const now = Date.now();
  if (macProfileCache.value && now - macProfileCache.at < 60000) return macProfileCache.value;

  const profile = {
    chipName: null,
    gpuName: null,
    modelName: null,
  };

  try {
    const hw = await execText('system_profiler', ['SPHardwareDataType']);
    profile.chipName = parseSystemProfilerValue(hw, 'Chip');
    profile.modelName = parseSystemProfilerValue(hw, 'Model Name');
  } catch {
    /* system_profiler may be slow or unavailable in constrained builds */
  }

  try {
    const displays = await execText('system_profiler', ['SPDisplaysDataType']);
    profile.gpuName = parseSystemProfilerValue(displays, 'Chipset Model');
  } catch {
    /* ignore */
  }

  if (!profile.chipName) {
    try {
      profile.chipName = (await execText('sysctl', ['-n', 'machdep.cpu.brand_string'])).trim() || null;
    } catch {
      /* Apple Silicon can omit this sysctl on some macOS versions */
    }
  }

  macProfileCache = { at: now, value: profile };
  return profile;
}

function parsePowermetricsTemp(stdout, label) {
  const re = new RegExp(`${label}[^\\n:]*:\\s*([0-9]+(?:\\.[0-9]+)?)\\s*C`, 'i');
  const n = Number(stdout.match(re)?.[1]);
  return Number.isFinite(n) ? Math.round(n) : null;
}

async function getMacTemps() {
  try {
    const stdout = await execText(
      'powermetrics',
      ['--samplers', 'smc', '-n', '1', '-i', '1000'],
      { ...EXEC_OPTS, timeout: 3500, maxBuffer: 2 * 1024 * 1024 }
    );
    return {
      cpuTempC: parsePowermetricsTemp(stdout, 'CPU die temperature'),
      gpuTempC: parsePowermetricsTemp(stdout, 'GPU die temperature'),
    };
  } catch {
    return { cpuTempC: null, gpuTempC: null };
  }
}

function parseVmStatPages(stdout, labels) {
  for (const label of labels) {
    const re = new RegExp(`^\\s*${label}:\\s*([0-9.]+)`, 'im');
    const raw = stdout.match(re)?.[1];
    if (!raw) continue;
    const pages = Number(raw.replace(/\./g, ''));
    if (Number.isFinite(pages)) return pages;
  }
  return 0;
}

async function getMacMemoryUsageBytes() {
  try {
    const pageSizeRaw = await execText('sysctl', ['-n', 'vm.pagesize']);
    const pageSize = Number(String(pageSizeRaw || '').trim());
    if (!Number.isFinite(pageSize) || pageSize <= 0) return null;

    const vmStat = await execText('vm_stat', []);
    const pagesActive = parseVmStatPages(vmStat, ['Pages active']);
    const pagesWired = parseVmStatPages(vmStat, ['Pages wired down', 'Pages wired']);
    const pagesCompressed = parseVmStatPages(vmStat, ['Pages occupied by compressor']);
    const usedPages = pagesActive + pagesWired + pagesCompressed;
    if (!Number.isFinite(usedPages) || usedPages <= 0) return null;
    return usedPages * pageSize;
  } catch {
    return null;
  }
}

async function getMacHardwareSnapshot(base) {
  const profile = await getMacProfile();
  const temps = await getMacTemps();
  const chip = profile.chipName || 'Apple Silicon';
  const gpuName = profile.gpuName || chip;

  return {
    ...base,
    cpuTempC: temps.cpuTempC,
    ramTempC: null,
    gpuAvailable: true,
    gpuName,
    gpuTempC: temps.gpuTempC,
    gpuLoadPercent: null,
    gpuMemoryUsedMb: null,
    gpuMemoryTotalMb: null,
    gpuMemoryPercent: null,
    chipName: chip,
    modelName: profile.modelName,
    monitoringSource: 'macOS Apple Silicon',
  };
}

/**
 * CPU / RAM from Node's OS APIs.
 * macOS exposes some GPU load counters through private or privileged APIs; unsupported values stay null.
 */
export async function getHardwareSnapshot() {
  const totalmem = os.totalmem();
  let usedmem = totalmem - os.freemem();
  if (process.platform === 'darwin') {
    const macUsed = await getMacMemoryUsageBytes();
    if (Number.isFinite(macUsed) && macUsed > 0) {
      usedmem = Math.min(totalmem, macUsed);
    }
  }
  const base = {
    cpuPercent: await measureCpuPercent(220),
    cpuCores: os.cpus().length,
    cpuTempC: null,
    ramTempC: null,
    memoryUsedPercent: Math.round((usedmem / totalmem) * 1000) / 10,
    memoryUsedMb: Math.round(usedmem / 1024 / 1024),
    memoryTotalMb: Math.round(totalmem / 1024 / 1024),
    platform: os.platform(),
    monitoringSource: 'built-in',
    gpuAvailable: false,
    gpuName: null,
    gpuTempC: null,
    gpuLoadPercent: null,
    gpuMemoryUsedMb: null,
    gpuMemoryTotalMb: null,
    gpuMemoryPercent: null,
  };

  if (process.platform === 'darwin') {
    return getMacHardwareSnapshot(base);
  }

  return base;
}
