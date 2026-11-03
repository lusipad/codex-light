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

#[tauri::command]
pub async fn generated_image_save(data_base64: String) -> Result<Option<String>, String> {
    let (bytes, extension) = decode_image(&data_base64)?;
    tokio::task::spawn_blocking(move || {
        let path = rfd::FileDialog::new()
            .set_title("保存图片")
            .set_file_name(format!("image.{extension}"))
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
