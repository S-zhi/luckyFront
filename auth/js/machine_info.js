// getStatValueElement returns the device-info display element on the auth page.
const getStatValueElement = () =>
  document.querySelector("[data-machine-info]") || document.getElementById("stat-value");

// getNavigatorUAData returns the experimental browser UA data object when available.
const getNavigatorUAData = () => navigator.userAgentData || null;

// detectCPUArch resolves the client CPU architecture from browser hints when available.
const detectCPUArch = async () => {
  const uaData = getNavigatorUAData();
  if (uaData && typeof uaData.getHighEntropyValues === "function") {
    try {
      const values = await uaData.getHighEntropyValues(["architecture", "bitness"]);
      const architecture = String(values.architecture || "").trim();
      const bitness = String(values.bitness || "").trim();
      if (architecture) {
        return bitness ? `${architecture}/${bitness}` : architecture;
      }
    } catch (error) {
      // Ignore unsupported UA entropy APIs and fall back to user agent parsing.
    }
  }

  const userAgent = String(navigator.userAgent || "").toLowerCase();
  const platform = String(navigator.platform || "").toLowerCase();
  const source = `${userAgent} ${platform}`;

  if (source.includes("aarch64") || source.includes("arm64")) return "arm64";
  if (source.includes("arm")) return "arm";
  if (source.includes("x86_64") || source.includes("win64") || source.includes("x64")) return "x86_64";
  if (source.includes("i686") || source.includes("x86")) return "x86";
  return "Unknown CPU";
};

// detectMemoryGB resolves the browser-reported device memory in GB when available.
const detectMemoryGB = () => {
  const memoryGB = Number(navigator.deviceMemory);
  if (Number.isFinite(memoryGB) && memoryGB > 0) {
    return `${memoryGB}GB`;
  }
  return "Unknown Memory";
};

// detectOS resolves the client operating system from browser-provided platform hints.
const detectOS = async () => {
  const uaData = getNavigatorUAData();
  if (uaData && typeof uaData.getHighEntropyValues === "function") {
    try {
      const values = await uaData.getHighEntropyValues(["platform", "platformVersion"]);
      const platform = String(values.platform || "").trim();
      const platformVersion = String(values.platformVersion || "").trim();
      if (platform) {
        return platformVersion ? `${platform} ${platformVersion}` : platform;
      }
    } catch (error) {
      // Ignore unsupported UA entropy APIs and fall back to user agent parsing.
    }
  }

  const userAgent = String(navigator.userAgent || "");
  if (/Windows NT/i.test(userAgent)) return "Windows";
  if (/Android/i.test(userAgent)) return "Android";
  if (/iPhone|iPad|iPod/i.test(userAgent)) return "iOS";
  if (/Mac OS X|Macintosh/i.test(userAgent)) return "macOS";
  if (/Linux/i.test(userAgent)) return "Linux";
  return "Unknown OS";
};

// detectGPUName resolves the WebGL renderer name when the browser exposes it.
const detectGPUName = () => {
  const canvas = document.createElement("canvas");
  const gl =
    canvas.getContext("webgl") ||
    canvas.getContext("experimental-webgl") ||
    canvas.getContext("webgl2");
  if (!gl) return "Unknown GPU";

  const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
  if (debugInfo) {
    const renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
    if (renderer) {
      return String(renderer).trim();
    }
  }

  const renderer = gl.getParameter(gl.RENDERER);
  if (renderer) {
    return String(renderer).trim();
  }
  return "Unknown GPU";
};

// detectMachineInfo collects the client-side device environment using browser APIs.
const detectMachineInfo = async () => {
  const [cpuArch, os] = await Promise.all([detectCPUArch(), detectOS()]);
  return {
    cpuArch,
    memoryGB: detectMemoryGB(),
    gpuName: detectGPUName(),
    os,
    timestamp: new Date().toISOString(),
  };
};

// formatMachineInfo converts device metadata into a compact auth-page summary line.
const formatMachineInfo = (machineInfo) =>
  `${machineInfo.cpuArch} | ${machineInfo.memoryGB} | ${machineInfo.gpuName} | ${machineInfo.os}`;

// updateMachineInfoDisplay writes the detected client environment into the auth page.
const updateMachineInfoDisplay = async () => {
  const statValueEl = getStatValueElement();
  if (!statValueEl) return;

  statValueEl.textContent = "Detecting client environment...";

  try {
    const machineInfo = await detectMachineInfo();
    statValueEl.textContent = formatMachineInfo(machineInfo);
    statValueEl.title = `Detected at ${machineInfo.timestamp}`;
    window.machineInfo = machineInfo;
  } catch (error) {
    statValueEl.textContent = "Client environment unavailable";
  }
};

// machineInfoApi exposes browser-side device detection for auth-page consumers.
const machineInfoApi = {
  async fetch() {
    return detectMachineInfo();
  },
};

window.machineInfoApi = machineInfoApi;

void updateMachineInfoDisplay();
