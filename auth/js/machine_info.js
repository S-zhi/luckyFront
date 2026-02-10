// mock 数据，供前端联调使用
const mockMachineInfo = {
  cpuArch: "x86_64",
  memoryGB: 32,
  gpuName: "NVIDIA GeForce RTX 3070",
  os: "macOS",
  timestamp: "2024-01-01T12:00:00Z",
};

// 切换为 true 时，直接返回 mock 数据
const USE_MOCK_MACHINE_INFO = true;

// 由后端透传机器信息的接口占位
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

// 挂到全局，方便其他脚本调用
window.machineInfoApi = machineInfoApi;
window.mockMachineInfo = mockMachineInfo;

if (USE_MOCK_MACHINE_INFO) {
    console.warn(
        "Using mock machine info data. Set USE_MOCK_MACHINE_INFO to false to disable."
    );
}else { 
    console.log("Fetching machine info from backend API.");
    mockMachineInfo = machineInfoApi;
}
document.getElementById("stat-value").innerText = mockMachineInfo.cpuArch + " | " + mockMachineInfo.memoryGB + "GB | " + mockMachineInfo.gpuName + " | " + mockMachineInfo.os;

