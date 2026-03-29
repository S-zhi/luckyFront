const mockMachineInfo = {
  cpuArch: "x86_64",
  memoryGB: 32,
  gpuName: "NVIDIA GeForce RTX 3070",
  os: "macOS",
  timestamp: "2024-01-01T12:00:00Z",
};

const USE_MOCK_MACHINE_INFO = true;

const machineInfoApi = {
  async fetch() {
    if (USE_MOCK_MACHINE_INFO) {
      return new Promise((resolve) => {
        setTimeout(() => resolve({ ...mockMachineInfo }), 300);
      });
    }

    const response = await fetch("/api/machine-info", {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error("Failed to load machine info.");
    }

    return response.json();
  },
};

window.machineInfoApi = machineInfoApi;
window.mockMachineInfo = mockMachineInfo;

const statValueEl = document.getElementById("stat-value");

if (statValueEl && USE_MOCK_MACHINE_INFO) {
  statValueEl.innerText = `${mockMachineInfo.cpuArch} | ${mockMachineInfo.memoryGB}GB | ${mockMachineInfo.gpuName} | ${mockMachineInfo.os}`;
}
