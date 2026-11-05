//! Read-only system font metadata. Enumeration order is preserved, not fabricated.
use serde::Serialize;
use std::sync::OnceLock;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemFontFace {
    full_name: String,
    postscript_name: String,
    style_name: String,
    is_monospaced: bool,
}

#[derive(Clone, Debug, Serialize)]
pub struct SystemFontFamily {
    family: String,
    faces: Vec<SystemFontFace>,
}

static FAMILIES: OnceLock<Result<Vec<SystemFontFamily>, String>> = OnceLock::new();

#[cfg(target_os = "windows")]
fn enumerate() -> Result<Vec<SystemFontFamily>, String> {
    use std::ffi::c_void;
    type Callback = unsafe extern "C" fn(
        *mut c_void,
        *const u16,
        usize,
        *const u16,
        usize,
        *const u16,
        usize,
        *const u16,
        usize,
        u8,
    );
    extern "C" {
        fn codex_system_fonts(context: *mut c_void, callback: Callback) -> i32;
    }
    unsafe extern "C" fn receive(
        context: *mut c_void,
        family: *const u16,
        family_len: usize,
        full_name: *const u16,
        full_len: usize,
        postscript: *const u16,
        postscript_len: usize,
        style: *const u16,
        style_len: usize,
        mono: u8,
    ) {
        // Native strings remain alive for this synchronous callback only.
        let decode = |ptr, len| String::from_utf16_lossy(std::slice::from_raw_parts(ptr, len));
        let families = &mut *(context as *mut Vec<SystemFontFamily>);
        let family = decode(family, family_len);
        let face = SystemFontFace {
            full_name: decode(full_name, full_len),
            postscript_name: decode(postscript, postscript_len),
            style_name: decode(style, style_len),
            is_monospaced: mono != 0,
        };
        if let Some(entry) = families.iter_mut().find(|entry| entry.family == family) {
            if !entry
                .faces
                .iter()
                .any(|existing| existing.postscript_name == face.postscript_name)
            {
                entry.faces.push(face);
            }
        } else {
            families.push(SystemFontFamily {
                family,
                faces: vec![face],
            });
        }
    }
    let mut result: Vec<SystemFontFamily> = Vec::new();
    let hr = unsafe { codex_system_fonts(&mut result as *mut _ as *mut c_void, receive) };
    if hr < 0 {
        Err(format!(
            "读取 Windows 系统字体失败 (HRESULT 0x{:08X})",
            hr as u32
        ))
    } else {
        Ok(result)
    }
}

#[cfg(not(target_os = "windows"))]
fn enumerate() -> Result<Vec<SystemFontFamily>, String> {
    Err("此平台不支持系统字体目录".into())
}

#[tauri::command]
pub async fn system_font_families() -> Result<Vec<SystemFontFamily>, String> {
    tauri::async_runtime::spawn_blocking(|| FAMILIES.get_or_init(enumerate).clone())
        .await
        .map_err(|error| format!("读取系统字体任务失败: {error}"))?
}

#[cfg(all(test, target_os = "windows"))]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn real_system_font_directory_has_unique_valid_faces_and_monospace_metadata() {
        let families = enumerate().expect("real DirectWrite font enumeration");
        assert!(!families.is_empty());
        let mut names = HashSet::new();
        let mut has_monospace = false;
        for family in &families {
            assert!(!family.family.trim().is_empty());
            assert!(names.insert(&family.family));
            assert!(!family.faces.is_empty());
            let mut faces = HashSet::new();
            for face in &family.faces {
                assert!(!face.full_name.trim().is_empty());
                assert!(!face.postscript_name.trim().is_empty());
                assert!(!face.style_name.trim().is_empty());
                assert!(faces.insert(&face.postscript_name));
                has_monospace |= face.is_monospaced;
            }
        }
        assert!(
            has_monospace,
            "system directory contains a real monospaced face"
        );
        let json = serde_json::to_value(&families).unwrap();
        let face = &json[0]["faces"][0];
        assert!(face["fullName"].is_string());
        assert!(face["postscriptName"].is_string());
        assert!(face["styleName"].is_string());
        assert!(face["isMonospaced"].is_boolean());
        assert!(face.get("full_name").is_none());
        if let Some(output) = std::env::var_os("CODEX_SYSTEM_FONTS_EVIDENCE") {
            let output = std::path::PathBuf::from(output);
            assert!(output.is_absolute(), "font evidence path must be absolute");
            std::fs::write(output, serde_json::to_vec_pretty(&json).unwrap())
                .expect("write requested system font test evidence");
        }
    }
}
