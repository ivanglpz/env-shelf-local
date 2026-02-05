import type { DiffItem, EnvLine } from "../types";

export const linesToRaw = (lines: EnvLine[]): string => {
  return lines
    .map((line) => {
      if (line.kind === "blank") return "";
      if (line.kind === "comment") return line.raw;
      if (line.kind === "unknown") return line.raw;
      if (line.raw) return line.raw;
      const prefix = line.hasExport ? "export " : "";
      return `${prefix}${line.key}=${line.value}`;
    })
    .join("\n");
};

const kvRegex = /^\s*(export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/;

export const parseRawToLines = (raw: string): EnvLine[] => {
  const rows = raw.split(/\r?\n/);
  return rows.map((row) => {
    if (row.trim() === "") {
      return { kind: "blank" };
    }
    if (row.trim().startsWith("#") || row.trim().startsWith(";")) {
      return { kind: "comment", raw: row };
    }
    const match = row.match(kvRegex);
    if (match) {
      const hasExport = Boolean(match[1]);
      const key = match[2] ?? "";
      const value = match[3] ?? "";
      return { kind: "kv", key, value, hasExport, raw: row };
    }
    return { kind: "unknown", raw: row };
  });
};

export const getKvMap = (lines: EnvLine[]): Map<string, string> => {
  const map = new Map<string, string>();
  lines.forEach((line) => {
    if (line.kind === "kv") {
      map.set(line.key, line.value);
    }
  });
  return map;
};

export const diffKv = (before: EnvLine[], after: EnvLine[]): DiffItem[] => {
  const beforeMap = getKvMap(before);
  const afterMap = getKvMap(after);
  const items: DiffItem[] = [];
  beforeMap.forEach((value, key) => {
    if (!afterMap.has(key)) {
      items.push({ key, change: "removed", before: value });
    } else if (afterMap.get(key) !== value) {
      items.push({ key, change: "updated", before: value, after: afterMap.get(key) });
    }
  });
  afterMap.forEach((value, key) => {
    if (!beforeMap.has(key)) {
      items.push({ key, change: "added", after: value });
    }
  });
  return items.sort((a, b) => a.key.localeCompare(b.key));
};

export const updateLinesWithKv = (
  lines: EnvLine[],
  key: string,
  value: string
): EnvLine[] => {
  let updated = false;
  const next = lines.map((line) => {
    if (line.kind === "kv" && line.key === key) {
      updated = true;
      return { ...line, value, raw: undefined };
    }
    return line;
  });
  if (updated) return next;

  const lastKvIndex = [...next].reverse().findIndex((line) => line.kind === "kv");
  if (lastKvIndex === -1) {
    return [...next, { kind: "kv", key, value, hasExport: false }];
  }
  const insertIndex = next.length - lastKvIndex;
  return [
    ...next.slice(0, insertIndex),
    { kind: "kv", key, value, hasExport: false },
    ...next.slice(insertIndex)
  ];
};

export const removeKvKey = (lines: EnvLine[], key: string): EnvLine[] => {
  return lines.filter((line) => !(line.kind === "kv" && line.key === key));
};

export const listKvLines = (lines: EnvLine[]): EnvLine[] => {
  return lines.filter((line) => line.kind === "kv");
};

export const findDuplicateKeys = (lines: EnvLine[]): string[] => {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  lines.forEach((line) => {
    if (line.kind === "kv") {
      if (seen.has(line.key)) {
        duplicates.add(line.key);
      }
      seen.add(line.key);
    }
  });
  return Array.from(duplicates);
};
