import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { fileURLToPath } from 'url';

const execFileAsync = promisify(execFile);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OHM_PS1 = path.join(__dirname, 'ohm-sensors.ps1');

function clampPct(n) {
  if (!Number.isFinite(n)) return null;
  return Math.round(Math.max(0, Math.min(100, n)) * 10) / 10;
}

function clampTemp(n) {
  if (!Number.isFinite(n)) return null;
  return Math.round(Math.max(0, Math.min(125, n)));
}

/**
 * Map raw WMI sensors from Open Hardware Monitor to CPU / RAM / GPU load %.
 * Identifier paths follow OHM (e.g. /intelcpu/0/load/0, /ram/load/0, /nvidiagpu/0/load/0).
 */
function mapSensors(sensors) {
  const norm = (Array.isArray(sensors) ? sensors : [])
    .map((x) => ({
      id: String(x.Identifier ?? x.I ?? '').trim(),
      name: String(x.Name ?? x.N ?? '').trim(),
      v: Number(x.Value ?? x.V),
    }))
    .filter((x) => Number.isFinite(x.v));

  const byId = (re) => norm.find((s) => re.test(s.id));
  const byName = (re) => norm.find((s) => re.test(s.name));

  let cpuPercent =
    byName(/^CPU Total$/i)?.v ??
    byId(/\/intelcpu\/\d+\/load\/0$/i)?.v ??
    byId(/\/amdcpu\/\d+\/load\/0$/i)?.v;

  if (cpuPercent == null) {
    const loads = norm.filter((s) => /\/intelcpu\/\d+\/load\/\d+$/i.test(s.id) || /\/amdcpu\/\d+\/load\/\d+$/i.test(s.id));
    if (loads.length) {
      const sum = loads.reduce((a, s) => a + s.v, 0);
      cpuPercent = sum / loads.length;
    }
  }

  const ramPercent = byId(/^\/ram\/load\/0$/i)?.v;

  let gpuLoadPercent =
    byId(/^\/nvidiagpu\/\d+\/load\/0$/i)?.v ??
    byId(/^\/amdgpu\/\d+\/load\/0$/i)?.v ??
    byId(/^\/intelgpu\/\d+\/load\/0$/i)?.v ??
    byName(/^GPU Core$/i)?.v;

  let gpuName = null;
  if (norm.some((s) => /^\/nvidiagpu\//i.test(s.id))) gpuName = 'NVIDIA';
  else if (norm.some((s) => /^\/amdgpu\//i.test(s.id))) gpuName = 'AMD';
  else if (norm.some((s) => /^\/intelgpu\//i.test(s.id))) gpuName = 'Intel';

  const cpuTempSensors = norm.filter(
    (s) =>
      /\/intelcpu\/\d+\/temperature\/\d+$/i.test(s.id) || /\/amdcpu\/\d+\/temperature\/\d+$/i.test(s.id)
  );
  let cpuTempC = null;
  if (cpuTempSensors.length) {
    cpuTempC = clampTemp(Math.max(...cpuTempSensors.map((s) => s.v)));
  } else {
    const pkg = norm.find(
      (s) =>
        /^CPU Package$/i.test(s.name) &&
        /\/(intelcpu|amdcpu)\/.*temperature/i.test(s.id)
    );
    cpuTempC = clampTemp(pkg?.v);
  }

  let gpuTempC =
    clampTemp(byId(/^\/nvidiagpu\/\d+\/temperature\/0$/i)?.v) ??
    clampTemp(byId(/^\/nvidiagpu\/\d+\/temperature\/\d+$/i)?.v);
  if (gpuTempC == null) {
    gpuTempC =
      clampTemp(byId(/^\/amdgpu\/\d+\/temperature\/0$/i)?.v) ??
      clampTemp(byId(/^\/intelgpu\/\d+\/temperature\/0$/i)?.v);
  }

  const ramTempSensors = norm.filter((s) => /\/ram\/temperature\/\d+$/i.test(s.id));
  let ramTempC = null;
  if (ramTempSensors.length) {
    ramTempC = clampTemp(Math.max(...ramTempSensors.map((s) => s.v)));
  } else {
    const gmem = norm.filter((s) => /\/genericmemory\/\d+\/temperature\/\d+$/i.test(s.id));
    if (gmem.length) ramTempC = clampTemp(Math.max(...gmem.map((s) => s.v)));
  }

  const any =
    cpuPercent != null ||
    ramPercent != null ||
    gpuLoadPercent != null ||
    cpuTempC != null ||
    gpuTempC != null ||
    ramTempC != null;
  if (!any) return null;

  return {
    ok: true,
    cpuPercent: cpuPercent != null ? clampPct(cpuPercent) : null,
    memoryUsedPercent: ramPercent != null ? clampPct(ramPercent) : null,
    gpuLoadPercent: gpuLoadPercent != null ? clampPct(gpuLoadPercent) : null,
    gpuAvailable: gpuLoadPercent != null,
    gpuName,
    cpuTempC,
    gpuTempC,
    ramTempC,
  };
}

/**
 * Read sensors via Open Hardware Monitor WMI. Returns null if OHM is not running or WMI fails.
 */
export async function fetchOpenHardwareMonitor() {
  if (process.platform !== 'win32') return null;

  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', OHM_PS1],
      { timeout: 12000, windowsHide: true, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' }
    );
    const parsed = JSON.parse(stdout.trim());
    if (!parsed || parsed.ok !== true || !Array.isArray(parsed.sensors)) return null;
    return mapSensors(parsed.sensors);
  } catch {
    return null;
  }
}
