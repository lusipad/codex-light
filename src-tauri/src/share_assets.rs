use base64::Engine;
use chrono::{DateTime, Utc};
use serde::Serialize;
use serde_json::Value;
use std::fs::{self, File, Metadata};
use std::io::Read;
use std::path::{Component, Path, PathBuf};

const IMAGE_LIMIT: u64 = 25 * 1024 * 1024;
const HTML_LIMIT: u64 = 5_000_000;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalShareAsset {
    pub data_base64: String,
    pub mime_type: String,
}

fn thread_date(thread_id: &str) -> Option<String> {
    let id = uuid::Uuid::parse_str(thread_id).ok()?;
    if id.hyphenated().to_string() != thread_id.to_ascii_lowercase() {
        return None;
    }
    let bytes = id.as_bytes();
    if bytes[8] & 0xc0 != 0x80 {
        return None;
    }
    let millis = match bytes[6] >> 4 {
        7 => bytes[..6]
            .iter()
            .fold(0_i64, |value, byte| (value << 8) | i64::from(*byte)),
        8 if bytes[5] & 0x03 == 0 => {
            i64::from(u32::from_be_bytes(bytes[..4].try_into().ok()?)) * 1000
        }
        _ => return None,
    };
    Some(
        DateTime::<Utc>::from_timestamp_millis(millis)?
            .format("%Y/%m/%d")
            .to_string(),
    )
}

fn parse_source(source: &str) -> Result<PathBuf, String> {
    if source.is_empty()
        || source.trim() != source
        || source.chars().any(char::is_control)
        || source.starts_with("//")
        || source.starts_with("\\\\")
        || source.contains('%')
    {
        return Err("无效的本地分享资产路径".into());
    }
    let bytes = source.as_bytes();
    let drive = bytes.len() > 2
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && matches!(bytes[2], b'/' | b'\\');
    if source.contains(':') && (!drive || source[2..].contains(':')) {
        return Err("分享资产不支持 URL、设备路径或数据流".into());
    }
    if source
        .split(['/', '\\'])
        .any(|part| matches!(part, "." | ".."))
    {
        return Err("分享资产不支持点路径段".into());
    }
    let path = PathBuf::from(source);
    if path
        .components()
        .any(|part| matches!(part, Component::ParentDir | Component::CurDir))
    {
        return Err("无效的本地分享资产路径".into());
    }
    #[cfg(windows)]
    if source.starts_with('\\') || (source.starts_with('/') && !path.is_absolute()) {
        return Err("分享资产不支持根相对路径".into());
    }
    #[cfg(not(windows))]
    if drive || source.contains('\\') {
        return Err("分享资产路径与当前平台不符".into());
    }
    Ok(path)
}

fn forbidden_link(metadata: &Metadata) -> bool {
    if metadata.file_type().is_symlink() {
        return true;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        // Includes directory junctions and other reparse points.
        metadata.file_attributes() & 0x400 != 0
    }
    #[cfg(not(windows))]
    {
        false
    }
}

fn read_within(path: &Path, root: &Path, limit: u64) -> Option<Vec<u8>> {
    if !root.is_absolute() || !path.starts_with(root) {
        return None;
    }
    // Resolve the approved boundary, then inspect every component below it.
    // Canonical boundaries may themselves be configured through a link.
    let canonical_root = fs::canonicalize(root).ok()?;
    let relative = path.strip_prefix(root).ok()?;
    let target = canonical_root.join(relative);
    let mut current = target.as_path();
    let mut reached = false;
    for depth in 0..=64 {
        let metadata = fs::symlink_metadata(current).ok()?;
        if forbidden_link(&metadata)
            || if depth == 0 {
                !metadata.is_file()
            } else {
                !metadata.is_dir()
            }
        {
            return None;
        }
        if current == canonical_root {
            reached = true;
            break;
        }
        current = current.parent()?;
    }
    if !reached {
        return None;
    }
    let mut file = File::open(&target).ok()?;
    if file.metadata().ok()?.len() > limit {
        return None;
    }
    let mut bytes = Vec::new();
    (&mut file).take(limit + 1).read_to_end(&mut bytes).ok()?;
    (bytes.len() as u64 <= limit).then_some(bytes)
}

fn image_mime(path: &Path) -> Option<&'static str> {
    match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
        "png" => Some("image/png"),
        "jpg" => Some("image/jpeg"),
        "jpeg" => Some("image/jpeg"),
        "webp" => Some("image/webp"),
        "gif" => Some("image/gif"),
        "avif" => Some("image/avif"),
        _ => None,
    }
}

fn html_name(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
        return false;
    };
    let Some(stem) = name.strip_suffix(".html") else {
        return false;
    };
    !stem.is_empty()
        && stem.split('-').all(|part| {
            !part.is_empty()
                && part
                    .bytes()
                    .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
        })
}

/// The caller supplies fresh host-owned thread metadata and checks identity/cancel
/// before and after this bounded read. Only local hosts are supported by this API.
/// This policy is deliberately stricter than the official generic image reader.
pub fn read_local_share_asset(
    thread_id: &str,
    source: &str,
    kind: &str,
    thread: &Value,
    codex_home: &Path,
) -> Result<Option<LocalShareAsset>, String> {
    if thread.get("id").and_then(Value::as_str) != Some(thread_id)
        || thread_id.is_empty()
        || !thread_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
    {
        return Err("分享资产与会话不匹配".into());
    }
    if !matches!(kind, "image" | "visualization") {
        return Err("不支持的分享资产类型".into());
    }
    let source_path = parse_source(source)?;
    let cwd = thread
        .get("cwd")
        .and_then(Value::as_str)
        .map(PathBuf::from)
        .filter(|path| path.is_absolute());
    let date = thread_date(thread_id);
    let visualization_root = date
        .as_ref()
        .filter(|_| codex_home.is_absolute())
        .map(|date| codex_home.join("visualizations").join(date).join(thread_id));
    let (mime, limit) = if kind == "visualization" {
        if date.is_none() || !html_name(&source_path) {
            return Err("无效的会话 visualization 路径".into());
        }
        if !source_path.is_absolute() && source_path.components().count() != 1 {
            return Err("相对 visualization 路径必须为文件名".into());
        }
        ("application/octet-stream", HTML_LIMIT)
    } else {
        let Some(mime) = image_mime(&source_path) else {
            return Ok(None);
        };
        (mime, IMAGE_LIMIT)
    };
    let candidates = if source_path.is_absolute() {
        let mut roots: Vec<(PathBuf, PathBuf)> = cwd
            .into_iter()
            .map(|root| (root.clone(), root))
            .chain(visualization_root.map(|root| (root, codex_home.to_path_buf())))
            .collect();
        roots.sort_by_key(|(root, _)| std::cmp::Reverse(root.as_os_str().len()));
        roots
            .into_iter()
            .filter(|(root, _)| source_path.starts_with(root))
            .map(|(_, boundary)| (source_path.clone(), boundary))
            .collect::<Vec<_>>()
    } else if kind == "visualization" {
        visualization_root
            .into_iter()
            .map(|root| (root.join(&source_path), codex_home.to_path_buf()))
            .collect()
    } else {
        cwd.into_iter()
            .map(|root| (root.join(&source_path), root))
            .collect()
    };
    for (path, root) in candidates {
        if let Some(bytes) = read_within(&path, &root, limit) {
            return Ok(Some(LocalShareAsset {
                data_base64: base64::engine::general_purpose::STANDARD.encode(bytes),
                mime_type: mime.into(),
            }));
        }
    }
    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let path =
                std::env::temp_dir().join(format!("codex-share-assets-{}", uuid::Uuid::new_v4()));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }
        fn thread(&self) -> Value {
            json!({"id": "019a45ce-0000-7000-8000-000000000000", "cwd": self.0.join("work")})
        }
        fn read(&self, source: &str, kind: &str) -> Result<Option<LocalShareAsset>, String> {
            read_local_share_asset(
                "019a45ce-0000-7000-8000-000000000000",
                source,
                kind,
                &self.thread(),
                &self.0.join("home"),
            )
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            // A fixed temp fixture, never a caller-provided deletion path.
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn reads_cwd_image_and_rejects_outside_and_invalid_sources() {
        let f = Fixture::new();
        fs::create_dir_all(f.0.join("work")).unwrap();
        fs::write(f.0.join("work/image.PNG"), b"test bytes").unwrap();
        let image = f.read("image.PNG", "image").unwrap().unwrap();
        assert_eq!(image.mime_type, "image/png");
        assert_eq!(image.data_base64, "dGVzdCBieXRlcw==");
        fs::write(f.0.join("outside.png"), b"outside").unwrap();
        assert!(f
            .read(f.0.join("outside.png").to_str().unwrap(), "image")
            .unwrap()
            .is_none());
        for source in [
            "../outside.png",
            "./image.PNG",
            "file:///image.png",
            "//server/share/image.png",
            "image%2epng",
            "C:\\file.png:secret",
            "\\\\?\\C:\\file.png",
        ] {
            assert!(f.read(source, "image").is_err(), "{source}");
        }
        assert!(f.read("missing.png", "image").unwrap().is_none());
        assert!(f.read("image.svg", "image").unwrap().is_none());
        assert!(f.read("image.PNG", "other").is_err());
    }

    #[test]
    fn metadata_id_and_visualization_date_are_required() {
        let f = Fixture::new();
        assert!(read_local_share_asset("other", "image.png", "image", &f.thread(), &f.0).is_err());
        assert_eq!(
            thread_date("019a45ce-0000-7000-8000-000000000000").as_deref(),
            Some("2025/11/02")
        );
        assert_eq!(thread_date("not-a-uuid"), None);
        assert_eq!(thread_date("019a45ce-0000-4000-8000-000000000000"), None);
        assert!(read_local_share_asset(
            "not-a-uuid",
            "chart.html",
            "visualization",
            &json!({"id":"not-a-uuid"}),
            &f.0
        )
        .is_err());
    }

    #[test]
    fn visualization_is_bound_to_default_thread_directory_or_cwd() {
        let f = Fixture::new();
        let directory =
            f.0.join("home/visualizations")
                .join(thread_date("019a45ce-0000-7000-8000-000000000000").unwrap())
                .join("019a45ce-0000-7000-8000-000000000000");
        fs::create_dir_all(&directory).unwrap();
        fs::write(directory.join("chart.html"), b"<html>test</html>").unwrap();
        let asset = f.read("chart.html", "visualization").unwrap().unwrap();
        assert_eq!(asset.mime_type, "application/octet-stream");
        for source in [
            "sub/chart.html",
            "Chart.html",
            "chart--bad.html",
            "../chart.html",
        ] {
            assert!(f.read(source, "visualization").is_err(), "{source}");
        }
        fs::create_dir_all(f.0.join("work")).unwrap();
        fs::write(f.0.join("work/chart.html"), b"cwd").unwrap();
        assert!(f
            .read(
                f.0.join("work/chart.html").to_str().unwrap(),
                "visualization"
            )
            .unwrap()
            .is_some());
        assert!(f
            .read(
                f.0.join("home/visualizations/2025/11/03/other/chart.html")
                    .to_str()
                    .unwrap(),
                "visualization"
            )
            .unwrap()
            .is_none());
    }

    #[test]
    fn enforces_byte_limits_and_ancestor_depth() {
        let f = Fixture::new();
        fs::create_dir_all(f.0.join("work")).unwrap();
        let path = f.0.join("work/large.png");
        File::create(&path).unwrap().set_len(IMAGE_LIMIT).unwrap();
        assert!(f.read("large.png", "image").unwrap().is_some());
        File::create(&path)
            .unwrap()
            .set_len(IMAGE_LIMIT + 1)
            .unwrap();
        assert!(f.read("large.png", "image").unwrap().is_none());
        let html = f.0.join("work/chart.html");
        File::create(&html).unwrap().set_len(HTML_LIMIT).unwrap();
        assert!(f
            .read(html.to_str().unwrap(), "visualization")
            .unwrap()
            .is_some());
        File::create(&html)
            .unwrap()
            .set_len(HTML_LIMIT + 1)
            .unwrap();
        assert!(f
            .read(html.to_str().unwrap(), "visualization")
            .unwrap()
            .is_none());
        let deep = (0..65).fold(f.0.join("work"), |path, _| path.join("d"));
        fs::create_dir_all(&deep).unwrap();
        fs::write(deep.join("tiny.png"), b"x").unwrap();
        assert!(f
            .read(deep.join("tiny.png").to_str().unwrap(), "image")
            .unwrap()
            .is_none());
    }

    #[test]
    fn rejects_file_and_parent_symlinks() {
        let f = Fixture::new();
        let work = f.0.join("work");
        fs::create_dir_all(work.join("real")).unwrap();
        fs::write(work.join("real/image.png"), b"image").unwrap();
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(work.join("real/image.png"), work.join("linked.png"))
                .unwrap();
            std::os::unix::fs::symlink(work.join("real"), work.join("linked")).unwrap();
        }
        #[cfg(windows)]
        {
            if let Err(error) = std::os::windows::fs::symlink_file(
                work.join("real/image.png"),
                work.join("linked.png"),
            ) {
                eprintln!("SKIP symlink fixture: Windows denied symlink creation: {error}");
                return;
            }
            if let Err(error) =
                std::os::windows::fs::symlink_dir(work.join("real"), work.join("linked"))
            {
                eprintln!(
                    "SKIP directory symlink fixture: Windows denied symlink creation: {error}"
                );
                return;
            }
        }
        assert!(f.read("linked.png", "image").unwrap().is_none());
        assert!(f.read("linked/image.png", "image").unwrap().is_none());
    }
}
