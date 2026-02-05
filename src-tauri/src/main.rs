#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use chrono::Local;
use regex::Regex;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashSet};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};
use tauri::State;
use thiserror::Error;
use walkdir::WalkDir;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EnvFileRef {
    id: String,
    absolute_path: String,
    file_name: String,
    folder_path: String,
    size: u64,
    modified_at: i64,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectGroup {
    id: String,
    name: String,
    root_path: String,
    env_files: Vec<EnvFileRef>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
enum EnvLine {
    Blank,
    Comment { raw: String },
    Kv {
        key: String,
        value: String,
        #[serde(rename = "hasExport")]
        has_export: bool,
        raw: Option<String>,
    },
    Unknown { raw: String },
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EnvDocument {
    file: EnvFileRef,
    lines: Vec<EnvLine>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScanResult {
    root_path: String,
    groups: Vec<ProjectGroup>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WriteOptions {
    create_backup: bool,
}

#[derive(Default)]
struct AppState {
    root_path: Mutex<Option<PathBuf>>,
    allowed_files: Mutex<HashSet<PathBuf>>,
    cancel_scan: AtomicBool,
}

#[derive(Error, Debug, Serialize)]
#[serde(tag = "type", content = "message")]
enum AppError {
    #[error("Invalid root path")]
    InvalidRootPath,
    #[error("Path not allowed")]
    PathNotAllowed,
    #[error("Scan canceled")]
    ScanCanceled,
    #[error("IO error: {0}")]
    IoError(String),
    #[error("Regex error")]
    RegexError,
}

impl From<std::io::Error> for AppError {
    fn from(value: std::io::Error) -> Self {
        AppError::IoError(value.to_string())
    }
}

fn hash_path(path: &Path) -> String {
    let mut hasher = Sha256::new();
    hasher.update(path.to_string_lossy().as_bytes());
    format!("{:x}", hasher.finalize())
}

fn normalize_path(path: &Path) -> Result<PathBuf, AppError> {
    let canonical = path.canonicalize().map_err(AppError::from)?;
    Ok(canonical)
}

fn is_env_file_name(name: &str, regex: &Regex) -> bool {
    regex.is_match(name)
}

fn is_ignored_dir(entry: &walkdir::DirEntry) -> bool {
    if !entry.file_type().is_dir() {
        return false;
    }
    let ignored = [
        "node_modules",
        ".git",
        "dist",
        "build",
        ".next",
        "target",
        ".turbo",
        ".cache",
    ];
    entry
        .file_name()
        .to_str()
        .map(|name| ignored.contains(&name))
        .unwrap_or(false)
}

fn ensure_allowed_path(state: &AppState, path: &Path) -> Result<(), AppError> {
    let root_guard = state.root_path.lock().map_err(|_| AppError::InvalidRootPath)?;
    let root = root_guard.clone().ok_or(AppError::InvalidRootPath)?;
    let normalized = normalize_path(path)?;
    if !normalized.starts_with(&root) {
        return Err(AppError::PathNotAllowed);
    }
    let allowed_guard = state.allowed_files.lock().map_err(|_| AppError::PathNotAllowed)?;
    if !allowed_guard.contains(&normalized) {
        return Err(AppError::PathNotAllowed);
    }
    Ok(())
}

#[tauri::command]
fn cancel_scan(state: State<'_, AppState>) -> Result<(), AppError> {
    state.cancel_scan.store(true, Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
fn scan_env_files(state: State<'_, AppState>, root_path: String) -> Result<ScanResult, AppError> {
    let root = normalize_path(Path::new(&root_path))?;
    state.cancel_scan.store(false, Ordering::SeqCst);

    let regex = Regex::new(r"^\.env(\..+)?$").map_err(|_| AppError::RegexError)?;

    let mut groups: BTreeMap<PathBuf, Vec<EnvFileRef>> = BTreeMap::new();
    let mut allowed_files: HashSet<PathBuf> = HashSet::new();

    for entry in WalkDir::new(&root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| !is_ignored_dir(e))
    {
        if state.cancel_scan.load(Ordering::SeqCst) {
            return Err(AppError::ScanCanceled);
        }
        let entry = entry.map_err(|e| AppError::IoError(e.to_string()))?;
        if !entry.file_type().is_file() {
            continue;
        }
        let file_name = entry.file_name().to_string_lossy();
        if !is_env_file_name(&file_name, &regex) {
            continue;
        }

        let path = entry.path().to_path_buf();
        let metadata = fs::metadata(&path)?;
        let modified = metadata.modified().ok();
        let modified_at = modified
            .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|dur| dur.as_millis() as i64)
            .unwrap_or(0);

        let folder = path.parent().unwrap_or(&root).to_path_buf();
        let env_ref = EnvFileRef {
            id: hash_path(&path),
            absolute_path: path.to_string_lossy().to_string(),
            file_name: file_name.to_string(),
            folder_path: folder.to_string_lossy().to_string(),
            size: metadata.len(),
            modified_at,
        };

        groups.entry(folder).or_default().push(env_ref);
        allowed_files.insert(normalize_path(&path)?);
    }

    let mut result_groups: Vec<ProjectGroup> = groups
        .into_iter()
        .map(|(folder, mut files)| {
            files.sort_by(|a, b| a.file_name.cmp(&b.file_name));
            let name = folder
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| folder.to_string_lossy().to_string());
            ProjectGroup {
                id: hash_path(&folder),
                name,
                root_path: folder.to_string_lossy().to_string(),
                env_files: files,
            }
        })
        .collect();

    result_groups.sort_by(|a, b| a.name.cmp(&b.name));

    let mut root_guard = state.root_path.lock().map_err(|_| AppError::InvalidRootPath)?;
    *root_guard = Some(root.clone());

    let mut allowed_guard = state.allowed_files.lock().map_err(|_| AppError::PathNotAllowed)?;
    *allowed_guard = allowed_files;

    Ok(ScanResult {
        root_path: root.to_string_lossy().to_string(),
        groups: result_groups,
    })
}

fn parse_env_lines(raw: &str) -> Vec<EnvLine> {
    let kv_regex = Regex::new(r"^\s*(export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$")
        .unwrap_or_else(|_| Regex::new("$").unwrap());

    raw.split('\n')
        .map(|line| {
            let trimmed = line.trim();
            let line = line.trim_end_matches('\r');
            if trimmed.is_empty() {
                EnvLine::Blank
            } else if trimmed.starts_with('#') || trimmed.starts_with(';') {
                EnvLine::Comment {
                    raw: line.to_string(),
                }
            } else if let Some(caps) = kv_regex.captures(line) {
                let has_export = caps.get(1).is_some();
                let key = caps.get(2).map(|m| m.as_str()).unwrap_or("");
                let value = caps.get(3).map(|m| m.as_str()).unwrap_or("");
                EnvLine::Kv {
                    key: key.to_string(),
                    value: value.to_string(),
                    has_export,
                    raw: Some(line.to_string()),
                }
            } else {
                EnvLine::Unknown {
                    raw: line.to_string(),
                }
            }
        })
        .collect()
}

#[tauri::command]
fn read_env_file(state: State<'_, AppState>, path: String) -> Result<EnvDocument, AppError> {
    let path_buf = PathBuf::from(&path);
    ensure_allowed_path(&state, &path_buf)?;

    let contents = fs::read_to_string(&path_buf)?;
    let lines = parse_env_lines(&contents);
    let metadata = fs::metadata(&path_buf)?;
    let modified_at = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|dur| dur.as_millis() as i64)
        .unwrap_or(0);

    let folder = path_buf.parent().unwrap_or(&path_buf).to_path_buf();
    let file_name = path_buf
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string());

    let file = EnvFileRef {
        id: hash_path(&path_buf),
        absolute_path: path_buf.to_string_lossy().to_string(),
        file_name,
        folder_path: folder.to_string_lossy().to_string(),
        size: metadata.len(),
        modified_at,
    };

    Ok(EnvDocument { file, lines })
}

#[tauri::command]
fn write_env_file(
    state: State<'_, AppState>,
    path: String,
    content: String,
    options: WriteOptions,
) -> Result<(), AppError> {
    let path_buf = PathBuf::from(&path);
    ensure_allowed_path(&state, &path_buf)?;

    if options.create_backup {
        let timestamp = Local::now().format("%Y%m%d%H%M%S");
        let file_name = path_buf
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_else(|| "env".to_string());
        let backup_name = format!(".{}.backup-{}", file_name, timestamp);
        let backup_path = path_buf
            .parent()
            .unwrap_or_else(|| Path::new("."))
            .join(backup_name);
        fs::copy(&path_buf, backup_path)?;
    }

    let temp_name = format!(
        ".{}.tmp-{}",
        path_buf
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_else(|| "env".to_string()),
        Local::now().format("%Y%m%d%H%M%S")
    );
    let temp_path = path_buf
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join(temp_name);

    let mut file = fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(&temp_path)?;
    file.write_all(content.as_bytes())?;
    file.flush()?;
    file.sync_all()?;

    fs::rename(&temp_path, &path_buf)?;
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            scan_env_files,
            read_env_file,
            write_env_file,
            cancel_scan
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
