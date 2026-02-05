import { invoke } from "@tauri-apps/api/tauri";
import type { EnvDocument, ScanResult, WriteOptions } from "@/types";

export const scanEnvFiles = async (rootPath: string): Promise<ScanResult> => {
  return invoke<ScanResult>("scan_env_files", { rootPath });
};

export const readEnvFile = async (path: string): Promise<EnvDocument> => {
  return invoke<EnvDocument>("read_env_file", { path });
};

export const writeEnvFile = async (
  path: string,
  content: string,
  options: WriteOptions
): Promise<void> => {
  return invoke<void>("write_env_file", { path, content, options });
};

export const cancelScan = async (): Promise<void> => {
  return invoke<void>("cancel_scan");
};
