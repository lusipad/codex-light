use base64::Engine;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledPetInfo {
    pub id: String,
    pub display_name: String,
    pub description: Option<String>,
    pub sprite_version_number: u32,
    pub spritesheet_path: String,
    pub spritesheet_data_url: Option<String>,
    pub directory_path: String,
    pub updated_at: u64,
}

fn sheet_dimensions(bytes: &[u8]) -> Result<(&'static str, u32, u32), String> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        let image = tauri::image::Image::from_bytes(bytes).map_err(|e| format!("PNG 无法解码：{e}"))?;
        return Ok(("image/png", image.width(), image.height()));
    }
    // No WebP decoder is configured: validate its RIFF envelope and frame dimensions,
    // but do not claim to validate compressed pixel data.
    if bytes.len() < 20 || &bytes[..4] != b"RIFF" || &bytes[8..12] != b"WEBP"
        || u32::from_le_bytes(bytes[4..8].try_into().unwrap()) as usize + 8 != bytes.len() {
        return Err("精灵图不是有效 PNG 或 WebP 容器。".into());
    }
    let mut offset = 12;
    let mut frame_dimensions = None;
    while offset + 8 <= bytes.len() {
        let tag = &bytes[offset..offset + 4];
        let length = u32::from_le_bytes(bytes[offset + 4..offset + 8].try_into().unwrap()) as usize;
        let end = offset.checked_add(8).and_then(|n| n.checked_add(length)).ok_or("WebP 长度无效。")?;
        if end > bytes.len() { return Err("WebP 数据截断。".into()); }
        let data = &bytes[offset + 8..end];
        let dimensions = if tag == b"VP8X" && data.len() >= 10 {
            Some((u32::from_le_bytes([data[4],data[5],data[6],0]) + 1, u32::from_le_bytes([data[7],data[8],data[9],0]) + 1))
        } else if tag == b"VP8 " && data.len() >= 10 && data[3..6] == [0x9d, 0x01, 0x2a] && data[0] & 1 == 0 {
            Some((u16::from_le_bytes([data[6], data[7]]) as u32 & 0x3fff,
                  u16::from_le_bytes([data[8], data[9]]) as u32 & 0x3fff))
        } else if tag == b"VP8L" && data.len() >= 5 && data[0] == 0x2f && data[4] >> 5 == 0 {
            let bits = u32::from_le_bytes(data[1..5].try_into().unwrap());
            Some(((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1))
        } else { None };
        if frame_dimensions.is_none() { frame_dimensions = dimensions; }
        offset = end + (length & 1);
    }
    if offset != bytes.len() { return Err("WebP 容器长度无效。".into()); }
    frame_dimensions.map(|(width, height)| ("image/webp", width, height))
        .ok_or_else(|| "WebP 缺少支持的静态图像帧。".into())
}

pub fn list_installed() -> Result<Vec<InstalledPetInfo>, String> {
    list_installed_at(&crate::state::codex_home_dir())
}

fn list_installed_at(home: &Path) -> Result<Vec<InstalledPetInfo>, String> {
    if !home.exists() { return Ok(Vec::new()); }
    let home = home.canonicalize().map_err(|e| format!("宠物配置根目录无法读取：{e}"))?;
    let mut result = HashMap::new();
    // The current pets library supersedes a legacy avatar with the same directory ID.
    for (directory, manifest_name) in [("avatars", "avatar.json"), ("pets", "pet.json")] {
        let root = home.join(directory);
        if !root.exists() { continue; }
        let root = root.canonicalize().map_err(|e| format!("宠物目录无法读取：{e}"))?;
        if !root.starts_with(&home) { return Err("宠物目录超出配置根目录。".into()); }
        for entry in fs::read_dir(&root).map_err(|e| format!("宠物目录无法读取：{e}"))? {
            let entry = entry.map_err(|e| format!("宠物目录项无法读取：{e}"))?;
            let path = entry.path();
            if !path.is_dir() { continue; }
            let directory_name = entry.file_name().into_string().map_err(|_| "宠物目录名称不是有效 Unicode。")?;
            let pet_root = path.canonicalize().map_err(|e| format!("宠物目录无法解析：{e}"))?;
            if !pet_root.starts_with(&root) || pet_root == root { return Err("宠物目录超出本地资源根目录。".into()); }
            let manifest_path = pet_root.join(manifest_name).canonicalize().map_err(|e| format!("宠物缺少 {manifest_name}：{e}"))?;
            if !manifest_path.starts_with(&pet_root) { return Err("宠物清单超出宠物目录。".into()); }
            let manifest: serde_json::Value = serde_json::from_slice(&fs::read(&manifest_path).map_err(|e| e.to_string())?)
                .map_err(|e| format!("宠物清单损坏：{e}"))?;
            if !manifest.is_object() { return Err("宠物清单必须为对象。".into()); }
            let optional_text = |key: &str| -> Result<Option<String>, String> {
                match manifest.get(key) {
                    None => Ok(None),
                    Some(serde_json::Value::String(value)) if !value.trim().is_empty() => Ok(Some(value.trim().to_owned())),
                    _ => Err(format!("宠物清单 {key} 必须为非空字符串。")),
                }
            };
            let manifest_id = optional_text("id")?;
            let display_name = optional_text("displayName")?.or(manifest_id).unwrap_or_else(|| directory_name.clone());
            let description = match manifest.get("description") {
                None | Some(serde_json::Value::Null) => None,
                Some(serde_json::Value::String(value)) => (!value.trim().is_empty()).then(|| value.trim().to_owned()),
                _ => return Err("宠物 description 必须为字符串。".into()),
            };
            let version = match manifest.get("spriteVersionNumber") {
                None => 1,
                Some(value) => value.as_u64().filter(|v| matches!(v, 1 | 2)).ok_or("宠物精灵版本仅支持 1 或 2。")? as u32,
            };
            let sheet_relative = optional_text("spritesheetPath")?.unwrap_or_else(|| "spritesheet.webp".into());
            if Path::new(&sheet_relative).is_absolute() { return Err("精灵图必须使用目录内相对路径。".into()); }
            let sheet = pet_root.join(&sheet_relative).canonicalize().map_err(|e| format!("精灵图无法读取：{e}"))?;
            if !sheet.starts_with(&pet_root) || !sheet.is_file() { return Err("精灵图超出宠物目录或不是文件。".into()); }
            let bytes = fs::read(&sheet).map_err(|e| format!("精灵图读取失败：{e}"))?;
            let (mime, width, height) = sheet_dimensions(&bytes)?;
            let expected_height = if version == 2 { 2288 } else { 1872 };
            if width != 1536 || height != expected_height {
                return Err(format!("精灵图尺寸 {width}x{height} 不符合版本 {version} 要求的 1536x{expected_height}。"));
            }
            let modified = |path: &Path| -> Result<u64, String> {
                let time = fs::metadata(path).and_then(|value| value.modified()).map_err(|e| format!("宠物修改时间无法读取：{e}"))?;
                Ok(time.duration_since(std::time::UNIX_EPOCH).map_err(|e| e.to_string())?.as_millis() as u64)
            };
            let id = format!("custom:{directory_name}");
            result.insert(id.clone(), InstalledPetInfo {
                id, display_name, description, sprite_version_number: version,
                spritesheet_path: sheet.to_string_lossy().into_owned(),
                spritesheet_data_url: Some(format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes))),
                directory_path: pet_root.to_string_lossy().into_owned(),
                updated_at: modified(&manifest_path)?.max(modified(&sheet)?),
            });
        }
    }
    let mut result: Vec<_> = result.into_values().collect();
    result.sort_by(|a, b| b.updated_at.cmp(&a.updated_at).then_with(|| a.id.cmp(&b.id)));
    Ok(result)
}

pub fn open_folder() -> Result<(), String> {
    let path = crate::state::codex_home_dir().join("pets");
    fs::create_dir_all(&path).map_err(|e| format!("宠物目录创建失败：{e}"))?;
    crate::reveal_path_in_explorer(path.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn fixture() -> std::path::PathBuf {
        let root = std::env::temp_dir().join(format!("codex-pets-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(root.join("pets/one")).unwrap();
        root
    }

    // Header-only sample tests container validation, not WebP pixel decoding.
    fn webp(width: u32, height: u32) -> Vec<u8> {
        let bits = (width - 1) | ((height - 1) << 14);
        let mut bytes = b"RIFF\x12\0\0\0WEBPVP8L\x05\0\0\0\x2f".to_vec();
        bytes.extend(bits.to_le_bytes()); bytes.push(0); bytes
    }

    fn manifest(root: &Path, value: serde_json::Value) {
        fs::write(root.join("pets/one/pet.json"), serde_json::to_vec(&value).unwrap()).unwrap();
    }

    #[test]
    fn pets_list_rejects_invalid_resources_and_keeps_mime_and_exact_dimensions() {
        let root = fixture();
        assert!(list_installed_at(&root).is_err());
        let valid = json!({"id":"manifest-id","displayName":" 一 ","description":" 本地 ","spriteVersionNumber":2,"spritesheetPath":"sheet.webp"});
        manifest(&root, valid.clone());
        fs::write(root.join("pets/one/sheet.webp"), webp(1536, 2288)).unwrap();
        fs::write(root.join("pets/outside.webp"), webp(1536, 2288)).unwrap();
        let list = list_installed_at(&root).unwrap();
        assert_eq!(list.len(), 1); assert_eq!(list[0].id, "custom:one");
        assert_eq!(list[0].display_name, "一"); assert_eq!(list[0].description.as_deref(),Some("本地"));
        assert_eq!(list[0].sprite_version_number, 2);
        assert!(list[0].spritesheet_data_url.as_ref().unwrap().starts_with("data:image/webp;base64,"));
        for (field, value) in [("id",json!(" ")),("id",json!(null)),("displayName",json!(false)),("spriteVersionNumber",json!(3)),("description",json!(false)),("spritesheetPath",json!("../outside.webp"))] {
            let mut invalid = valid.clone(); invalid[field] = value; manifest(&root, invalid);
            assert!(list_installed_at(&root).is_err());
        }
        fs::write(root.join("pets/one/pet.json"), b"{broken").unwrap();
        assert!(list_installed_at(&root).is_err());
        manifest(&root, valid.clone());
        for dimensions in [(80,110),(1536,1872),(1537,2288)] {
            fs::write(root.join("pets/one/sheet.webp"), webp(dimensions.0,dimensions.1)).unwrap();
            assert!(list_installed_at(&root).is_err());
        }
        fs::write(root.join("pets/one/sheet.webp"), b"not an image").unwrap();
        assert!(list_installed_at(&root).is_err());
        fs::remove_dir_all(&root).unwrap();
        assert!(list_installed_at(&root).unwrap().is_empty());
    }

    #[test]
    fn pets_optional_defaults_directory_ids_legacy_precedence_and_mtime_sort() {
        let root = fixture();
        manifest(&root, json!({}));
        fs::write(root.join("pets/one/spritesheet.webp"),webp(1536,1872)).unwrap();
        let first = list_installed_at(&root).unwrap().remove(0);
        assert_eq!(first.id,"custom:one"); assert_eq!(first.display_name,"one");
        assert_eq!(first.description,None); assert_eq!(first.sprite_version_number,1);
        manifest(&root,json!({"id":"  human label  ","description":"  "}));
        let readback = list_installed_at(&root).unwrap().remove(0);
        assert_eq!(readback.display_name,"human label"); assert_eq!(readback.description,None);
        for (directory,name,label) in [("avatars/one","avatar.json","legacy"),("avatars/two","avatar.json","legacy-two"),("pets/three","pet.json","third")] {
            let path=root.join(directory); fs::create_dir_all(&path).unwrap();
            fs::write(path.join(name),serde_json::to_vec(&json!({"id":"human label","displayName":label})).unwrap()).unwrap();
            fs::write(path.join("spritesheet.webp"),webp(1536,1872)).unwrap();
        }
        for (path,seconds) in [("pets/one/pet.json",200),("pets/one/spritesheet.webp",100),("avatars/one/avatar.json",800),("avatars/one/spritesheet.webp",900),("avatars/two/avatar.json",300),("avatars/two/spritesheet.webp",700),("pets/three/pet.json",400),("pets/three/spritesheet.webp",500)] {
            fs::File::options().write(true).open(root.join(path)).unwrap().set_times(fs::FileTimes::new().set_modified(std::time::UNIX_EPOCH+std::time::Duration::from_secs(seconds))).unwrap();
        }
        let result=list_installed_at(&root).unwrap();
        assert_eq!(result.iter().map(|v|v.id.as_str()).collect::<Vec<_>>(),["custom:two","custom:three","custom:one"]);
        assert_eq!(result[0].updated_at,700000); assert_eq!(result[1].updated_at,500000); assert_eq!(result[2].updated_at,200000);
        assert_eq!(result[2].display_name,"human label");
        assert!(result[2].directory_path.ends_with("one"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn pets_png_is_decoded_and_does_not_use_webp_mime() {
        let bytes = include_bytes!("../icons/icon.png");
        let (mime, width, height) = sheet_dimensions(bytes).unwrap();
        assert_eq!(mime, "image/png"); assert!(width > 0 && height > 0);
        assert!(sheet_dimensions(b"\x89PNG\r\n\x1a\nbroken").is_err());
        let mut truncated = webp(1536,1872); truncated.pop();
        assert!(sheet_dimensions(&truncated).is_err());
        let mut trailing = webp(1536,1872);
        trailing.extend_from_slice(b"BAD!");
        trailing[4..8].copy_from_slice(&22u32.to_le_bytes());
        assert!(sheet_dimensions(&trailing).is_err());
    }
}
