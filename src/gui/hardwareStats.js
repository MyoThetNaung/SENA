import * as os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { fetchOpenHardwareMonitor } from './openHardwareMonitor.js';

const execFileAsync = promisify(execFile);

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

const NVIDIA_SMI_ARGS = [
  '--query-gpu=name,temperature.gpu,utilization.gpu,memory.used,memory.total',
  '--format=csv,noheader,nounits',
];

const EXEC_GPU_OPTS = { timeout: 6000, windowsHide: true, maxBuffer: 512 * 1024 };

function nvidiaSmiCandidates() {
  const list = ['nvidia-smi'];
  if (process.platform === 'win32') {
    list.push(
      'C:\\Program Files\\NVIDIA Corporation\\NVSMI\\nvidia-smi.exe',
      'C:\\Windows\\System32\\nvidia-smi.exe'
    );
  }
  return list;
}

async function sampleGpuNvidia() {
  let stdout = '';
  try {
    let lastErr;
    for (const bin of nvidiaSmiCandidates()) {
      try {
        const out = await execFileAsync(bin, NVIDIA_SMI_ARGS, EXEC_GPU_OPTS);
        stdout = out.stdout;
        break;
      } catch (e) {
        lastErr = e;
      }
    }
    if (!stdout && lastErr) throw lastErr;
    const line = stdout.trim().split(/\r?\n/)[0];
    if (!line) {
      return {
        gpuAvailable: false,
        gpuName: null,
        gpuTempC: null,
        gpuLoadPercent: null,
        gpuMemoryUsedMb: null,
        gpuMemoryTotalMb: null,
        gpuMemoryPercent: null,
      };
    }
    const parts = line.split(',').map((s) => s.trim());
    if (parts.length < 5) {
      return {
        gpuAvailable: false,
        gpuName: null,
        gpuTempC: null,
        gpuLoadPercent: null,
        gpuMemoryUsedMb: null,
        gpuMemoryTotalMb: null,
        gpuMemoryPercent: null,
      };
    }
    const [name, tempRaw, util, memUsed, memTotal] = parts;
    const gpuTempC = parseFloat(tempRaw);
    const load = parseFloat(util);
    const mu = parseFloat(memUsed);
    const mt = parseFloat(memTotal);
    let gpuMemoryPercent = null;
    if (Number.isFinite(mu) && Number.isFinite(mt) && mt > 0) {
      gpuMemoryPercent = Math.round((mu / mt) * 1000) / 10;
    }
    return {
      gpuAvailable: true,
      gpuName: name || null,
      gpuTempC: Number.isFinite(gpuTempC) ? Math.round(gpuTempC) : null,
      gpuLoadPercent: Number.isFinite(load) ? Math.min(100, Math.max(0, load)) : null,
      gpuMemoryUsedMb: Number.isFinite(mu) ? Math.round(mu) : null,
      gpuMemoryTotalMb: Number.isFinite(mt) ? Math.round(mt) : null,
      gpuMemoryPercent,
    };
  } catch {
    return {
      gpuAvailable: false,
      gpuName: null,
      gpuTempC: null,
      gpuLoadPercent: null,
      gpuMemoryUsedMb: null,
      gpuMemoryTotalMb: null,
      gpuMemoryPercent: null,
    };
  }
}

/**
 * CPU / RAM from OS; GPU from nvidia-smi when present.
 * On Windows, prefers Open Hardware Monitor WMI when OHM is running (see project OpenHardwareMonitor folder).
 */
export async function getHardwareSnapshot() {
  const totalmem = os.totalmem();
  const freemem = os.freemem();
  const usedmem = totalmem - freemem;
  let memoryUsedPercent = Math.round((usedmem / totalmem) * 1000) / 10;

  const ohm = await fetchOpenHardwareMonitor();

  let cpuPercent = null;
  if (ohm?.ok && ohm.cpuPercent != null) {
    cpuPercent = ohm.cpuPercent;
  } else {
    cpuPercent = await measureCpuPercent(220);
  }

  if (ohm?.ok && ohm.memoryUsedPercent != null) {
    memoryUsedPercent = ohm.memoryUsedPercent;
  }

  let gpu = await sampleGpuNvidia();

  if (ohm?.ok) {
    if (ohm.gpuLoadPercent != null) {
      gpu = {
        ...gpu,
        gpuLoadPercent: ohm.gpuLoadPercent,
        gpuAvailable: true,
      };
      if (!gpu.gpuName && ohm.gpuName) {
        gpu = { ...gpu, gpuName: ohm.gpuName };
      }
    }
    if (gpu.gpuTempC == null && ohm.gpuTempC != null) {
      gpu = { ...gpu, gpuTempC: ohm.gpuTempC };
    }
  }

  const cpuTempC = ohm?.cpuTempC ?? null;
  const ramTempC = ohm?.ramTempC ?? null;

  const usedOhm =
    ohm?.ok &&
    (ohm.cpuPercent != null ||
      ohm.memoryUsedPercent != null ||
      ohm.gpuLoadPercent != null ||
      ohm.cpuTempC != null ||
      ohm.gpuTempC != null ||
      ohm.ramTempC != null);
  const monitoringSource = usedOhm ? 'OpenHardwareMonitor' : 'built-in';

  return {
    cpuPercent,
    cpuCores: os.cpus().length,
    cpuTempC,
    ramTempC,
    memoryUsedPercent,
    memoryUsedMb: Math.round(usedmem / 1024 / 1024),
    memoryTotalMb: Math.round(totalmem / 1024 / 1024),
    platform: os.platform(),
    monitoringSource,
    ...gpu,
  };
}
