use base64::{engine::general_purpose::STANDARD, Engine};
use std::path::PathBuf;

fn decode_image(data: &str) -> Result<(Vec<u8>, &'static str), String> {
    let bytes = STANDARD.decode(data).map_err(|_| "图片数据编码无效".to_string())?;
    let extension = if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        "png"
    } else if bytes.starts_with(b"\xff\xd8\xff") {
        "jpg"
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        "gif"
    } else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
        "webp"
    } else if bytes.len() >= 16 && &bytes[4..8] == b"ftyp"
        && bytes[8..].chunks_exact(4).take(8).any(|brand| brand == b"avif" || brand == b"avis") {
        "avif"
    } else {
        return Err("暂不支持此图片格式，未保存文件".to_string());
    };
    Ok((bytes, extension))
}

fn save_to_path(bytes: &[u8], path: Option<PathBuf>) -> Result<Option<String>, String> {
    let Some(path) = path else { return Ok(None); };
    std::fs::write(&path, bytes).map_err(|error| format!("保存图片失败：{error}"))?;
    let saved = std::fs::read(&path).map_err(|error| format!("图片已写入，但读取确认失败：{error}"))?;
    if saved != bytes {
        return Err("图片已写入，但内容确认失败".to_string());
    }
    Ok(Some(path.to_string_lossy().into_owned()))
}

fn suggested_filename(title: Option<&str>, extension: &str) -> String {
    let mut name: String = title.unwrap_or("image").trim().chars()
        .map(|character| if character.is_control() || "<>:\"/\\|?*".contains(character) { '_' } else { character })
        .collect();
    let mut end = name.len().min(240);
    while !name.is_char_boundary(end) { end -= 1; }
    name.truncate(end);
    let name = name.trim_end_matches(['.', ' ']);
    let name = if name.is_empty() { "image" } else { name };
    let device = name.split('.').next().unwrap_or_default().trim_end().to_ascii_uppercase();
    let reserved = matches!(device.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || device.strip_prefix("COM").or_else(|| device.strip_prefix("LPT"))
            .is_some_and(|number| matches!(number, "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "¹" | "²" | "³"));
    let prefix = if reserved { "_" } else { "" };
    format!("{prefix}{name}.{extension}")
}

#[tauri::command]
pub async fn generated_image_save(window: tauri::WebviewWindow, data_base64: String, suggested_title: Option<String>) -> Result<Option<String>, String> {
    let (bytes, extension) = decode_image(&data_base64)?;
    let filename = suggested_filename(suggested_title.as_deref(), extension);
    tokio::task::spawn_blocking(move || {
        let path = rfd::FileDialog::new()
            .set_parent(&window)
            .set_title("保存图片")
            .set_file_name(filename)
            .add_filter("图片", &[extension])
            .save_file();
        save_to_path(&bytes, path)
    }).await.map_err(|error| format!("无法打开图片保存对话框：{error}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generated_image_formats_use_bytes_and_reject_non_images() {
        for (bytes, expected) in [
            (&b"\x89PNG\r\n\x1a\nfixture"[..], "png"),
            (&b"\xff\xd8\xfffixture"[..], "jpg"),
            (&b"GIF89afixture"[..], "gif"),
            (&b"RIFF\x04\0\0\0WEBPfixture"[..], "webp"),
            (&b"\0\0\0\x18ftypavif\0\0\0\0"[..], "avif"),
        ] {
            let (actual, extension) = decode_image(&STANDARD.encode(bytes)).unwrap();
            assert_eq!(actual, bytes);
            assert_eq!(extension, expected);
        }
        assert!(decode_image("invalid base64!").is_err());
        assert!(decode_image(&STANDARD.encode(b"<html>403</html>")).is_err());
        assert!(decode_image("").is_err());
    }

    #[test]
    fn generated_image_suggestions_cannot_supply_a_path_or_extension() {
        assert_eq!(suggested_filename(None, "png"), "image.png");
        assert_eq!(suggested_filename(Some(" 中文/原图? "), "avif"), "中文_原图_.avif");
        assert_eq!(suggested_filename(Some("COM¹.txt"), "png"), "_COM¹.txt.png");
        assert_eq!(suggested_filename(Some("..."), "gif"), "image.gif");
        assert_eq!(suggested_filename(Some(&"字".repeat(100)), "png"), format!("{}.png", "字".repeat(80)));
    }

    #[test]
    fn generated_image_cancel_and_write_readback_preserve_exact_bytes() {
        let dir = std::env::temp_dir().join(format!("codex-image-save-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("image.png");
        assert_eq!(save_to_path(b"new", None).unwrap(), None);
        assert!(!path.exists());
        let bytes = b"\x89PNG\r\n\x1a\nexact fixture";
        assert!(save_to_path(bytes, Some(path.clone())).unwrap().is_some());
        assert_eq!(std::fs::read(&path).unwrap(), bytes);
        assert!(save_to_path(bytes, Some(dir.clone())).is_err());
        std::fs::remove_file(path).unwrap();
        std::fs::remove_dir(dir).unwrap();
    }
}
